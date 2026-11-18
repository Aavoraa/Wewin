import { type Tx, prisma } from '../db';

/** Prisma queries for users, sessions and login events. No business rules here. */
export const authRepo = {
  findUserByUsername(tx: Tx, username: string) {
    return tx.user.findUnique({ where: { username } });
  },

  /** User with role codes and permission keys (for the permission guard). */
  findUserAccess(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        fullName: true,
        isActive: true,
        mustChangePassword: true,
        roles: {
          select: {
            role: {
              select: {
                code: true,
                isActive: true,
                permissions: { select: { permissionKey: true } },
              },
            },
          },
        },
      },
    });
  },

  /** Active units of active exporters, for login and unit switching (Q-085). */
  activeUnits() {
    return prisma.businessUnit.findMany({
      where: { isActive: true, exporter: { isActive: true } },
      select: { id: true, code: true, name: true, docPrefix: true, exporter: { select: { id: true, code: true, legalName: true, tradeName: true } } },
      orderBy: [{ exporter: { code: 'asc' } }, { code: 'asc' }],
    });
  },

  /** Units a user is limited to; none = every active unit. */
  userUnitIds(userId: string) {
    return prisma.userUnit.findMany({ where: { userId }, select: { unitId: true } });
  },

  recordFailedLogin(tx: Tx, userId: string, failedCount: number, lockedUntil: Date | null) {
    return tx.user.update({
      where: { id: userId },
      data: { failedLoginCount: failedCount, lockedUntil },
    });
  },

  recordSuccessfulLogin(tx: Tx, userId: string) {
    return tx.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
  },

  logLoginEvent(
    tx: Tx,
    e: { username: string; userId?: string; success: boolean; reason?: string; ip?: string; userAgent?: string },
  ) {
    return tx.loginEvent.create({ data: e });
  },

  createSession(
    tx: Tx,
    s: { userId: string; familyId: string; unitId: string; tokenHash: string; expiresAt: Date; ip?: string; userAgent?: string },
  ) {
    return tx.session.create({ data: s });
  },

  findSessionByHash(tx: Tx, tokenHash: string) {
    return tx.session.findUnique({ where: { tokenHash } });
  },

  rotateSession(tx: Tx, id: string, replacedById: string) {
    return tx.session.update({
      where: { id },
      data: { revokedAt: new Date(), revokeReason: 'ROTATED', replacedById, lastUsedAt: new Date() },
    });
  },

  revokeSession(tx: Tx, id: string, reason: string) {
    return tx.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
  },

  revokeFamily(tx: Tx, familyId: string, reason: string) {
    return tx.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  },

  revokeAllForUser(tx: Tx, userId: string, reason: string) {
    return tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  },

  updatePassword(tx: Tx, userId: string, passwordHash: string) {
    return tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false, version: { increment: 1 } },
    });
  },

  getPasswordHash(tx: Tx, userId: string) {
    return tx.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  },
};
