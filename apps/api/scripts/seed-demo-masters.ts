/**
 * Demo masters (vendors, buyers, items, processes, demo rate contracts) and order WW-2627-001 —
 * the base the sample-data scripts build on. Idempotent (upserts by code). Same target rules as
 * the sample data (sample-session.ts): a non-local database needs SAMPLE_DATA_LIVE=yes.
 */
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to load demo data with NODE_ENV=production');
const { sampleTarget } = await import('./sample-session');
const target = sampleTarget();
const { PrismaClient } = await import('@prisma/client');
const { seedDemo } = await import('../../../packages/db/prisma/seed-demo');

const prisma = new PrismaClient();
try {
  if (!(await prisma.user.findUnique({ where: { username: 'owner' } }))) throw new Error('The target database has no foundation data (owner, roles) yet');
  await seedDemo(prisma);
  console.log(`• Demo masters and order WW-2627-001 ready (${target} database)`);
} finally {
  await prisma.$disconnect();
}
