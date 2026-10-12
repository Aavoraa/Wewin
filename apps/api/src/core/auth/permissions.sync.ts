import { PERMISSIONS, PERMISSION_KEYS, permissionModule } from '@wewin/shared';
import { withTx } from '../db';

/**
 * Make the permissions table match @wewin/shared at start-up and keep the OWNER role complete.
 * Other roles are never changed here (their bundles are edited by the Owner).
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
