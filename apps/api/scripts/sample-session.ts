/**
 * Shared start-up for the sample-data scripts: which database they write to, and how they act as
 * the owner.
 *
 *  - Local database: log in as `owner` with SEED_OWNER_PASSWORD (as before).
 *  - Any other database (e.g. the live Neon database): refused unless SAMPLE_DATA_LIVE=yes, and the
 *    owner is acted for in-process with a short-lived access token — no password is needed or
 *    stored (whoever runs this already holds the database connection string).
 */
import { randomUUID } from 'node:crypto';
import { type Express } from 'express';
import type request from 'supertest';

export function sampleTarget(): 'local' | 'live' {
  const url = process.env.DATABASE_URL ?? '';
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  if (['localhost', '127.0.0.1', '::1'].includes(host)) return 'local';
  if (process.env.SAMPLE_DATA_LIVE !== 'yes') {
    throw new Error(`DATABASE_URL points to ${host || 'an unknown host'}. Set SAMPLE_DATA_LIVE=yes to load sample data there on purpose.`);
  }
  return 'live';
}

export async function ownerToken(app: Express, req: typeof request): Promise<string> {
  if (sampleTarget() === 'live') {
    const { prisma } = await import('../src/core/db');
    const { signAccessToken } = await import('../src/core/auth/tokens');
    const owner = await prisma.user.findUnique({ where: { username: 'owner' } });
    if (!owner?.isActive) throw new Error('No active "owner" user in the target database');
    return signAccessToken(owner.id, randomUUID());
  }
  const password = process.env.SEED_OWNER_PASSWORD;
  if (!password) throw new Error('SEED_OWNER_PASSWORD is not set in .env');
  const login = await req(app).post('/api/v1/auth/login').send({ username: 'owner', password });
  if (login.status !== 200) throw new Error(`Owner login failed (${login.status}). Is SEED_OWNER_PASSWORD still the owner's password?`);
  return login.body.data.accessToken as string;
}
