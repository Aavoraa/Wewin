import { type Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

const userSelect = {
  id: true,
  username: true,
  fullName: true,
  email: true,
  phone: true,
  isActive: true,
  lockedUntil: true,
  lastLoginAt: true,
  mustChangePassword: true,
  version: true,
  createdAt: true,
  roles: { select: { role: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.UserSelect;

export const usersRepo = {
  list(where: Prisma.UserWhereInput, order: Prisma.UserOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.user.findMany({ where, orderBy: order, skip: p.skip, take: p.take, select: userSelect }),
      prisma.user.count({ where }),
    ]);
  },
  get(id: string, tx: Tx | typeof prisma = prisma) {
    return tx.user.findUnique({ where: { id }, select: userSelect });
  },
  create(tx: Tx, data: { username: string; fullName: string; email: string | null; phone: string | null; passwordHash: string; roleIds: string[] }) {
    const { roleIds, ...rest } = data;
    return tx.user.create({ data: { ...rest, mustChangePassword: true, roles: { create: roleIds.map((roleId) => ({ roleId })) } }, select: userSelect });
  },
  async update(tx: Tx, id: string, version: number, data: { fullName: string; email: string | null; phone: string | null; roleIds: string[] }) {
    const { roleIds, ...rest } = data;
    const r = await tx.user.updateMany({ where: { id, version }, data: { ...rest, version: { increment: 1 } } });
    if (r.count === 0) return null;
    await tx.userRole.deleteMany({ where: { userId: id, roleId: { notIn: roleIds } } });
    await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })), skipDuplicates: true });
    return tx.user.findUnique({ where: { id }, select: userSelect });
  },
  setActive(tx: Tx, id: string, isActive: boolean) {
    return tx.user.update({ where: { id }, data: { isActive, version: { increment: 1 } }, select: userSelect });
  },
  setPassword(tx: Tx, id: string, passwordHash: string) {
    return tx.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, version: { increment: 1 } },
      select: userSelect,
    });
  },
  revokeSessions(tx: Tx, userId: string, reason: string) {
    return tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
  },
  countRoles(ids: string[]) {
    return prisma.role.count({ where: { id: { in: ids } } });
  },
  activeOwnerCount(tx: Tx, excludingUserId?: string) {
    return tx.user.count({
      where: { isActive: true, roles: { some: { role: { code: 'OWNER' } } }, ...(excludingUserId ? { id: { not: excludingUserId } } : {}) },
    });
  },

  // ── Roles ──
  listRoles() {
    return prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: { permissions: { select: { permissionKey: true } }, _count: { select: { users: true } } },
    });
  },
  getRole(id: string, tx: Tx | typeof prisma = prisma) {
    return tx.role.findUnique({ where: { id }, include: { permissions: { select: { permissionKey: true } } } });
  },
  createRole(tx: Tx, data: { code: string; name: string; description: string | null; permissions: string[] }) {
    const { permissions, ...rest } = data;
    return tx.role.create({ data: { ...rest, permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) } } });
  },
  async updateRole(tx: Tx, id: string, version: number, data: { name: string; description: string | null; permissions: string[] }) {
    const { permissions, ...rest } = data;
    const r = await tx.role.updateMany({ where: { id, version }, data: { ...rest, version: { increment: 1 } } });
    if (r.count === 0) return null;
    await tx.rolePermission.deleteMany({ where: { roleId: id, permissionKey: { notIn: permissions } } });
    await tx.rolePermission.createMany({ data: permissions.map((permissionKey) => ({ roleId: id, permissionKey })), skipDuplicates: true });
    return tx.role.findUnique({ where: { id }, include: { permissions: { select: { permissionKey: true } } } });
  },
};
