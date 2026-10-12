import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { fyCodeFor, todayIst } from '@wewin/shared';
import { seedFoundation } from './seed-foundation';
import { seedDemo } from './seed-demo';

config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

async function main() {
  const prisma = new PrismaClient();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  if (!ownerPassword || ownerPassword.length < 10) {
    throw new Error('Set SEED_OWNER_PASSWORD (min 10 chars) in .env before seeding.');
  }
  const fy = Number(process.env.FY_START_MONTH ?? 4);
  const fyCodes = Array.from(new Set(['26-27', fyCodeFor(todayIst(), fy)]));
  try {
    await seedFoundation(prisma, { ownerPassword, fyCodes });
    if (process.env.SEED_DEMO !== 'false') await seedDemo(prisma);
    console.warn(`Seed complete (FY ${fyCodes.join(', ')}). Login as "owner" with SEED_OWNER_PASSWORD from .env.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
