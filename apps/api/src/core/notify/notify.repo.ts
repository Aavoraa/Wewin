import { type Tx, prisma } from '../db';

const recipient = { id: true, phone: true, email: true } as const;

export const notifyRepo = {
  /** Active users holding a permission (through an active role). */
  usersWithPermission(tx: Tx, permission: string) {
    return tx.user.findMany({
      where: { isActive: true, roles: { some: { role: { isActive: true, permissions: { some: { permissionKey: permission } } } } } },
      select: recipient,
    });
  },
  /** Active users holding one of these (active) roles. */
  usersWithRoles(tx: Tx, roleCodes: string[]) {
    return tx.user.findMany({ where: { isActive: true, roles: { some: { role: { isActive: true, code: { in: roleCodes } } } } }, select: recipient });
  },
  usersByIds(tx: Tx, ids: string[]) {
    return tx.user.findMany({ where: { id: { in: ids } }, select: recipient });
  },
  userName(tx: Tx, id: string) {
    return tx.user.findUnique({ where: { id }, select: { fullName: true } });
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
  createDeliveries(tx: Tx, rows: { notificationId: string; channel: string; status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED_NOT_CONFIGURED'; lastError?: string }[]) {
    return tx.notificationDelivery.createMany({ data: rows, skipDuplicates: true });
  },
  pendingDeliveries(limit = 50) {
    return prisma.notificationDelivery.findMany({
      where: { status: 'PENDING', channel: { in: ['WHATSAPP', 'EMAIL'] }, attempts: { lt: 5 } },
      take: limit,
      include: { notification: { include: { user: { select: { phone: true, email: true } } } } },
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
  /**
   * Accounts feed (Q-064): what a posted / cancelled document moved — totals per item and route,
   * read from the ledger (originals, or the reversal rows for a cancel). Read-only.
   */
  movementSummary(tx: Tx, sourceTypes: string[], sourceId: string, reversal: boolean) {
    return tx.$queryRaw<{ item: string; unit: string; from_loc: string; to_loc: string; qty: string; orders: string | null }[]>`
      SELECT i.name AS item, m.unit::text AS unit, lf.name AS from_loc, lt.name AS to_loc, SUM(m.qty)::text AS qty,
             string_agg(DISTINCT o.order_no, ', ') AS orders
      FROM stock_movements m
      JOIN items i ON i.id = m.item_id
      JOIN locations lf ON lf.id = m.from_location_id
      JOIN locations lt ON lt.id = m.to_location_id
      LEFT JOIN orders o ON o.id = m.order_id
      WHERE m.source_type = ANY(${sourceTypes}) AND m.source_id = ${sourceId}::uuid AND m.is_reversal = ${reversal}
      GROUP BY i.name, m.unit, lf.name, lt.name
      ORDER BY SUM(m.qty) DESC
      LIMIT 8`;
  },
};
