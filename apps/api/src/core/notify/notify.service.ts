import { type PermissionKey } from '@wewin/shared';
import { type Tx, afterCommit, withTx } from '../db';
import { logger } from '../logger';
import { QUEUES, jobs, registerJob } from '../../jobs/queue';
import { emailChannel, inAppChannel, whatsAppChannel } from './channels';
import { notifyRepo as repo } from './notify.repo';

export interface NotifyEvent {
  /** Idempotency key: the same business event never notifies a user twice (e.g. `EXCESS_LOSS:<dcId>`). */
  eventKey: string;
  kind: 'EXCESS_LOSS' | 'DC_OVERDUE' | 'GST_TIME_LIMIT' | 'PAYMENT_DUE' | 'REPORT_READY' | 'APPROVAL_REQUIRED' | string;
  title: string;
  body: string;
  link?: string | null;
  alertId?: string | null;
  /** Recipients: users holding this permission (Q-023: alerts.receive by default). */
  permission?: PermissionKey;
  /** Or explicit users (e.g. the requester of an export). */
  userIds?: string[];
  /** Or everyone holding one of these roles (accounts feed, Q-064). */
  roles?: string[];
  /** Also send by email (to users with an email address) when SMTP is configured. */
  email?: boolean;
}

/**
 * Notification service (automation A7). Writes in-app notifications inside the caller's transaction
 * (so they exist only if the business event commits), and queues WhatsApp / email deliveries only when a
 * provider is configured; otherwise records SKIPPED_NOT_CONFIGURED — never a fake "sent".
 */
export const notify = {
  async event(tx: Tx, e: NotifyEvent): Promise<number> {
    const users = e.userIds?.length
      ? await repo.usersByIds(tx, e.userIds)
      : e.roles
        ? await repo.usersWithRoles(tx, e.roles)
        : await repo.usersWithPermission(tx, e.permission ?? 'alerts.receive');
    const emailOf = new Map(users.map((u) => [u.id, u.email]));
    const created = await repo.createForUsers(tx, users, {
      kind: e.kind,
      title: e.title,
      body: e.body,
      link: e.link ?? null,
      eventKey: e.eventKey,
      alertId: e.alertId ?? null,
    });
    const wa = whatsAppChannel.isConfigured();
    const mail = emailChannel.isConfigured();
    await repo.createDeliveries(
      tx,
      created.flatMap((n) => [
        { notificationId: n.id, channel: inAppChannel.name, status: 'SENT' as const },
        { notificationId: n.id, channel: whatsAppChannel.name, status: wa ? ('PENDING' as const) : ('SKIPPED_NOT_CONFIGURED' as const) },
        ...(e.email
          ? [
              !mail
                ? { notificationId: n.id, channel: emailChannel.name, status: 'SKIPPED_NOT_CONFIGURED' as const }
                : emailOf.get(n.userId)
                  ? { notificationId: n.id, channel: emailChannel.name, status: 'PENDING' as const }
                  : { notificationId: n.id, channel: emailChannel.name, status: 'FAILED' as const, lastError: 'User has no email address' },
            ]
          : []),
      ]),
    );
    if ((wa || (e.email && mail)) && created.length) afterCommit(tx, async () => void (await jobs.send(QUEUES.NOTIFY_DISPATCH, {})));
    return created.length;
  },

  /** Convenience for callers outside a transaction (jobs). */
  async eventStandalone(e: NotifyEvent) {
    return withTx((tx) => this.event(tx, e), { isolation: 'ReadCommitted' });
  },

  /** Dispatch pending external deliveries with retry accounting (pg-boss retries the job on failure). */
  async dispatchPending(): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const d of await repo.pendingDeliveries()) {
      const channel = d.channel === 'EMAIL' ? emailChannel : whatsAppChannel;
      const to = d.channel === 'EMAIL' ? d.notification.user.email : d.notification.user.phone;
      if (!to) {
        await repo.markDelivery(d.id, { status: 'FAILED', lastError: d.channel === 'EMAIL' ? 'User has no email address' : 'User has no phone number' });
        failed++;
        continue;
      }
      try {
        const r = await channel.send({ to, title: d.notification.title, body: d.notification.body, link: d.notification.link });
        await repo.markDelivery(d.id, { status: 'SENT', providerMessageId: r.providerMessageId ?? null, lastError: null });
        sent++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await repo.markDelivery(d.id, { status: d.attempts + 1 >= 5 ? 'FAILED' : 'PENDING', lastError: msg });
        logger.warn({ err: msg, delivery: d.id }, 'notification delivery failed');
        failed++;
      }
    }
    return { sent, failed };
  },

  list: (userId: string, unreadOnly: boolean, take = 30) => repo.listForUser(userId, unreadOnly, take),
  unreadCount: (userId: string) => repo.unreadCount(userId),
  markRead: (userId: string, id?: string) => repo.markRead(userId, id),
};

registerJob(QUEUES.NOTIFY_DISPATCH, async () => {
  const r = await notify.dispatchPending();
  if (r.failed) throw new Error(`${r.failed} deliveries failed; will retry`);
});
