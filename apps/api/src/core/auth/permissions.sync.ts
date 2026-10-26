import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, PERMISSION_KEYS, ROLE_CODES, permissionModule } from '@wewin/shared';
import { withTx } from '../db';

/**
 * Make the permissions table match @wewin/shared at start-up and keep the OWNER role complete.
 * A permission seen for the first time is also given to the system roles whose default bundle
 * includes it (so a new feature reaches its intended roles on existing databases). Permissions that
 * already exist are never re-granted: the Owner's later edits of role bundles stand.
 */
export async function syncPermissions(): Promise<void> {
  await withTx(
    async (tx) => {
      const existing = new Set((await tx.permission.findMany({ select: { key: true } })).map((p) => p.key));
      const missing = PERMISSION_KEYS.filter((k) => !existing.has(k));
      if (missing.length) {
        await tx.permission.createMany({
          data: missing.map((key) => ({ key, module: permissionModule(key), description: PERMISSIONS[key] })),
          skipDuplicates: true,
        });
        // Only when the permissions table was already populated: a fresh database gets its bundles from the seed.
        if (existing.size) {
          const roles = await tx.role.findMany({ where: { code: { in: [...ROLE_CODES] } }, select: { id: true, code: true } });
          const grants = roles.flatMap((r) =>
            missing.filter((k) => DEFAULT_ROLE_PERMISSIONS[r.code as (typeof ROLE_CODES)[number]].includes(k)).map((permissionKey) => ({ roleId: r.id, permissionKey })),
          );
          if (grants.length) await tx.rolePermission.createMany({ data: grants, skipDuplicates: true });
        }
      }
      const owner = await tx.role.findUnique({ where: { code: 'OWNER' } });
      if (owner) {
        await tx.rolePermission.createMany({
          data: PERMISSION_KEYS.map((permissionKey) => ({ roleId: owner.id, permissionKey })),
          skipDuplicates: true,
        });
      }
    },
    { isolation: 'ReadCommitted' },
  );
}
