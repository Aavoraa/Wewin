import { createHash } from 'node:crypto';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

/** app_settings row recording which RESET_OWNER_PASSWORD value has already been applied (a hash, never the value). */
const APPLIED_KEY = 'ops.ownerPasswordResetApplied';

/**
 * Owner password recovery for a hosted database (run by ops/vercel/build.sh when
 * RESET_OWNER_PASSWORD is set). Sets the "owner" login's password, unlocks and re-activates it and
 * makes the owner choose a new password at the next login.
 *
 * Runs ONCE per value: the build records a hash of the value it applied and skips it on later
 * deploys, so a variable left in Vercel no longer resets the password (and forces a change) on every
 * deploy. To reset again, set a different value. Remove the variable when done.
 */
async function main() {
  const password = process.env.RESET_OWNER_PASSWORD ?? '';
  if (password.length < 10) throw new Error('RESET_OWNER_PASSWORD must be at least 10 characters');
  const fingerprint = createHash('sha256').update(`wewin-owner-reset:${password}`).digest('hex');
  const prisma = new PrismaClient();
  try {
    const applied = await prisma.appSetting.findUnique({ where: { key: APPLIED_KEY } });
    if (applied && (applied.value as { fingerprint?: string } | null)?.fingerprint === fingerprint) {
      console.warn('[reset-owner] this RESET_OWNER_PASSWORD was already applied on an earlier deploy — skipped. Remove the variable from Vercel.');
      return;
    }
    const owner = await prisma.user.findUnique({ where: { username: 'owner' } });
    if (!owner) {
      console.warn('[reset-owner] no "owner" login in this database — set SEED_OWNER_PASSWORD so the build creates it');
      return;
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: owner.id },
        data: {
          passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
          isActive: true,
          version: { increment: 1 },
        },
      }),
      prisma.appSetting.upsert({
        where: { key: APPLIED_KEY },
        create: { key: APPLIED_KEY, value: { fingerprint, at: new Date().toISOString() }, description: 'Last RESET_OWNER_PASSWORD applied by the build (hash only)' },
        update: { value: { fingerprint, at: new Date().toISOString() } },
      }),
    ]);
    console.warn('[reset-owner] owner password reset; it must be changed at the next login. Later deploys skip this value. Remove RESET_OWNER_PASSWORD now.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
