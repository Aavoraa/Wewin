import { type Tx, prisma } from '../db';

export const notifyRepo = {
  /** Active users holding a permission (through an active role). */
  usersWithPermission(tx: Tx, permission: string) {
    return tx.user.findMany({
      where: { isActive: true, roles: { some: { role: { isActive: true, permissions: { some: { permissionKey: permission } } } } } },
      select: { id: true, phone: true },
    });
  },
  async createForUsers(
    tx: Tx,
    users: { id: string }[],
    n: { kind: string; title: string; body: string; link: string | null; eventKey: string; alertId: string | null },
  ) {
    if (!users.length) return [];
    await tx.notification.createMany({ data: users.map((u) => ({ userId: u.id, ...n })), skipDuplicates: true });
    return tx.notification.findMany({ where: { eventKey: n.eventKey, userId: { in: users.map((u) => u.id) } }, select: { id: true, userId: true } });
  },
  createDeliveries(tx: Tx, rows: { notificationId: string; channel: string; status: 'PENDING' | 'SENT' | 'SKIPPED_NOT_CONFIGURED' }[]) {
    return tx.notificationDelivery.createMany({ data: rows, skipDuplicates: true });
  },
  pendingDeliveries(limit = 50) {
    return prisma.notificationDelivery.findMany({
      where: { status: 'PENDING', channel: 'WHATSAPP', attempts: { lt: 5 } },
      take: limit,
      include: { notification: { include: { user: { select: { phone: true } } } } },
    });
  },
  markDelivery(id: string, data: { status: 'SENT' | 'FAILED' | 'PENDING'; lastError?: string | null; providerMessageId?: string | null }) {
    return prisma.notificationDelivery.update({ where: { id }, data: { ...data, attempts: { increment: 1 } } });
  },
  listForUser(userId: string, unreadOnly: boolean, take: number) {
    return prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take,
      include: { deliveries: { select: { channel: true, status: true, attempts: true, lastError: true } } },
    });
  },
  unreadCount(userId: string) {
    return prisma.notification.count({ where: { userId, readAt: null } });
  },
  markRead(userId: string, id?: string) {
    return prisma.notification.updateMany({ where: { userId, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
  },
};
