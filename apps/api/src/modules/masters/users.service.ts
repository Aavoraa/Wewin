import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { PERMISSION_KEYS, type zMasterListQuery, type zRoleInput, type zRoleUpdate, type zUserCreate, type zUserUpdate } from '@wewin/shared';
import { withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { activeFilter, orderBy, paging } from '../../core/list';
import { hashPassword } from '../../core/auth/tokens';
import { invalidateAccessCache } from '../../core/auth/auth.middleware';
import { usersRepo as repo } from './users.repo';

const RC = { isolation: 'ReadCommitted' } as const;

function shapeUser<T extends { roles: { role: { id: string; code: string; name: string } }[] }>(u: T) {
  const { roles, ...rest } = u;
  return { ...rest, roles: roles.map((r) => r.role), roleIds: roles.map((r) => r.role.id) };
}

export const usersService = {
  async list(q: z.output<typeof zMasterListQuery>) {
    const p = paging(q);
    const where: Prisma.UserWhereInput = {
      ...activeFilter(q.active),
      ...(q.q
        ? { OR: [{ username: { contains: q.q, mode: 'insensitive' } }, { fullName: { contains: q.q, mode: 'insensitive' } }] }
        : {}),
    };
    const [rows, total] = await repo.list(
      where,
      orderBy<Prisma.UserOrderByWithRelationInput>(q.sort, { username: (d) => ({ username: d }), fullName: (d) => ({ fullName: d }), lastLoginAt: (d) => ({ lastLoginAt: d }) }, { username: 'asc' }),
      p,
    );
    return { rows: rows.map(shapeUser), total, p };
  },

  async get(id: string) {
    const u = await repo.get(id);
    if (!u) throw notFound('User');
    return shapeUser(u);
  },

  async create(input: z.output<typeof zUserCreate>) {
    if ((await repo.countRoles(input.roleIds)) !== input.roleIds.length) throw new AppError('VALIDATION_ERROR', 'Unknown role', 400);
    const { password, ...rest } = input;
    const passwordHash = await hashPassword(password);
    return withTx(async (tx) => shapeUser(await repo.create(tx, { ...rest, passwordHash })), RC);
  },

  async update(id: string, input: z.output<typeof zUserUpdate>) {
    if ((await repo.countRoles(input.roleIds)) !== input.roleIds.length) throw new AppError('VALIDATION_ERROR', 'Unknown role', 400);
    const out = await withTx(async (tx) => {
      const cur = await repo.get(id, tx);
      if (!cur) throw notFound('User');
      const wasOwner = cur.roles.some((r) => r.role.code === 'OWNER');
      const { version, ...data } = input;
      const u = await repo.update(tx, id, version, data);
      if (!u) throw versionConflict();
      if (wasOwner && !u.roles.some((r) => r.role.code === 'OWNER') && (await repo.activeOwnerCount(tx)) === 0) {
        throw new AppError('INVALID_STATE', 'At least one active Owner must remain', 409);
      }
      return shapeUser(u);
    }, RC);
    invalidateAccessCache(id);
    return out;
  },

  async setActive(id: string, isActive: boolean, actorId: string) {
    if (!isActive && id === actorId) throw new AppError('INVALID_STATE', 'You cannot deactivate yourself', 409);
    const out = await withTx(async (tx) => {
      if (!(await repo.get(id, tx))) throw notFound('User');
      const u = await repo.setActive(tx, id, isActive);
      if (!isActive) {
        await repo.revokeSessions(tx, id, 'DEACTIVATED');
        if ((await repo.activeOwnerCount(tx)) === 0) throw new AppError('INVALID_STATE', 'At least one active Owner must remain', 409);
      }
      return shapeUser(u);
    }, RC);
    invalidateAccessCache(id);
    return out;
  },

  async resetPassword(id: string, password: string) {
    const hash = await hashPassword(password);
    return withTx(async (tx) => {
      if (!(await repo.get(id, tx))) throw notFound('User');
      const u = await repo.setPassword(tx, id, hash);
      await repo.revokeSessions(tx, id, 'PASSWORD_RESET');
      return shapeUser(u);
    }, RC);
  },

  // ── Roles ──
  async listRoles() {
    const roles = await repo.listRoles();
    return roles.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      isActive: r.isActive,
      version: r.version,
      userCount: r._count.users,
      permissions: r.permissions.map((p) => p.permissionKey).sort(),
    }));
  },

  allPermissions() {
    return PERMISSION_KEYS;
  },

  createRole(input: z.output<typeof zRoleInput>) {
    return withTx((tx) => repo.createRole(tx, { ...input, description: input.description ?? null }), RC);
  },

  async updateRole(id: string, input: z.output<typeof zRoleUpdate>) {
    const out = await withTx(async (tx) => {
      const cur = await repo.getRole(id, tx);
      if (!cur) throw notFound('Role');
      if (cur.code === 'OWNER' && input.permissions.length !== PERMISSION_KEYS.length) {
        throw new AppError('INVALID_STATE', 'The Owner role always holds every permission', 409);
      }
      const { version, ...data } = input;
      const r = await repo.updateRole(tx, id, version, { ...data, description: data.description ?? null });
      if (!r) throw versionConflict();
      return r;
    }, RC);
    invalidateAccessCache();
    return out;
  },
};
