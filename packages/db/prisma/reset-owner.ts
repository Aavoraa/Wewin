import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

/**
 * Owner password recovery for a hosted database (run by ops/vercel/build.sh when
 * RESET_OWNER_PASSWORD is set). Sets the "owner" login's password, unlocks and re-activates it and
 * makes the owner choose a new password at the next login. The owner must already exist (the seed
 * creates it). Remove RESET_OWNER_PASSWORD from the environment after one deploy.
 */
async function main() {
  const password = process.env.RESET_OWNER_PASSWORD ?? '';
  if (password.length < 10) throw new Error('RESET_OWNER_PASSWORD must be at least 10 characters');
  const prisma = new PrismaClient();
  try {
    const owner = await prisma.user.findUnique({ where: { username: 'owner' } });
    if (!owner) {
      console.warn('[reset-owner] no "owner" login in this database — set SEED_OWNER_PASSWORD so the build creates it');
      return;
    }
    await prisma.user.update({
      where: { id: owner.id },
      data: {
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        isActive: true,
        version: { increment: 1 },
      },
    });
    console.warn('[reset-owner] owner password reset; it must be changed at the next login. Remove RESET_OWNER_PASSWORD now.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
