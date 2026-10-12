import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Bring the TEST database up to date (non-destructive `migrate deploy`) and apply the idempotent
 * foundation seed. Tests create uniquely-coded data, so they do not depend on an empty database.
 * To start from scratch, a developer can drop and recreate wewin_erp_test manually.
 */
export default async function setup() {
  const root = path.resolve(import.meta.dirname, '../../..');
  const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL! };
  if (!/_test\b/.test(env.DATABASE_URL)) throw new Error(`Refusing to migrate a non-test database: ${env.DATABASE_URL}`);
  execSync('pnpm --filter @wewin/db exec prisma migrate deploy', { cwd: root, env, stdio: 'pipe' });
  const { PrismaClient } = await import('@prisma/client');
  const { seedFoundation } = await import('../../../packages/db/prisma/seed-foundation');
  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  await seedFoundation(prisma, { ownerPassword: 'Owner-test-12345', fyCodes: ['26-27'] });
  await prisma.$disconnect();
}
