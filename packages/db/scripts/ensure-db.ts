import { PrismaClient } from '@prisma/client';

/** Create the database named in DATABASE_URL if it does not exist (dev / test / e2e only). */
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  const name = url.pathname.slice(1);
  if (!/^wewin_erp_(test|e2e)$/.test(name)) throw new Error(`Refusing to create ${name}: only *_test / *_e2e databases`);
  const admin = new URL(url);
  admin.pathname = '/wewin_erp';
  const prisma = new PrismaClient({ datasourceUrl: admin.toString() });
  const rows = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM pg_database WHERE datname = ${name}`;
  if (!rows[0]?.n) {
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    console.warn(`created database ${name}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
