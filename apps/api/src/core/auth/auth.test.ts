import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../db';
import { app, asUser, createUser, login } from '../../../test/helpers';
import { MAX_FAILED_LOGINS, nextLockState } from './auth.service';

function refreshCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const c = raw?.find((x) => x.startsWith('wewin_rt='));
  if (!c) throw new Error('no refresh cookie');
  return c.split(';')[0]!;
}

describe('nextLockState (pure)', () => {
  it('locks on the 5th consecutive failure for 15 minutes', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    expect(nextLockState(0, now)).toEqual({ failedCount: 1, lockedUntil: null });
    expect(nextLockState(MAX_FAILED_LOGINS - 2, now).lockedUntil).toBeNull();
    const locked = nextLockState(MAX_FAILED_LOGINS - 1, now);
    expect(locked.failedCount).toBe(0);
    expect(locked.lockedUntil?.toISOString()).toBe('2026-10-12T10:15:00.000Z');
  });
});

describe('POST /auth/login', () => {
  it('returns an access token, the user and a secure httpOnly refresh cookie', async () => {
    const u = await createUser(['stock.view']);
    const res = await login(u.username, u.password);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTypeOf('string');
    expect(res.body.data.user).toMatchObject({ username: u.username, permissions: ['stock.view'] });
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('wewin_rt='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    const events = await prisma.loginEvent.findMany({ where: { username: u.username } });
    expect(events.map((e) => e.success)).toEqual([true]);
  });

  it('rejects bad credentials with a generic message', async () => {
    const u = await createUser([]);
    const res = await login(u.username, 'wrong-password');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    const unknown = await login('no-such-user', 'whatever');
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(res.body.error.message);
  });

  it('locks the account after 5 failures, even for the correct password', async () => {
    const u = await createUser([]);
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) expect((await login(u.username, 'bad')).status).toBe(401);
    const res = await login(u.username, u.password);
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('refuses inactive users', async () => {
    const u = await createUser([]);
    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    expect((await login(u.username, u.password)).status).toBe(401);
  });

  it('validates the body', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('refresh rotation', () => {
  it('rotates the refresh token and detects reuse of an old token', async () => {
    const u = await createUser([]);
    const first = refreshCookie(await login(u.username, u.password));
    const r1 = await request(app).post('/api/v1/auth/refresh').set('cookie', first);
    expect(r1.status).toBe(200);
    const second = refreshCookie(r1);
    expect(second).not.toBe(first);

    // Reuse outside the grace window → whole family revoked.
    await prisma.session.updateMany({
      where: { userId: u.id, revokeReason: 'ROTATED' },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    const reuse = await request(app).post('/api/v1/auth/refresh').set('cookie', first);
    expect(reuse.status).toBe(401);
    const after = await request(app).post('/api/v1/auth/refresh').set('cookie', second);
    expect(after.status).toBe(401);
    const live = await prisma.session.count({ where: { userId: u.id, revokedAt: null } });
    expect(live).toBe(0);
  });

  it('logout revokes the session', async () => {
    const u = await createUser([]);
    const c = refreshCookie(await login(u.username, u.password));
    expect((await request(app).post('/api/v1/auth/logout').set('cookie', c)).status).toBe(204);
    expect((await request(app).post('/api/v1/auth/refresh').set('cookie', c)).status).toBe(401);
  });

  it('refresh without a cookie is 401', async () => {
    expect((await request(app).post('/api/v1/auth/refresh')).status).toBe(401);
  });
});

describe('authorisation', () => {
  it('requires a token on protected routes', async () => {
    expect((await request(app).get('/api/v1/stock/balances')).status).toBe(401);
    expect((await request(app).get('/api/v1/stock/balances').set('authorization', 'Bearer garbage')).status).toBe(401);
  });

  it('returns 403 when the permission is missing and 200 when present', async () => {
    const noPerm = await asUser(['dashboard.view']);
    const denied = await noPerm.get('/api/v1/stock/balances');
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatchObject({ code: 'FORBIDDEN', details: { missing: ['stock.view'] } });
    const ok = await asUser(['stock.view']);
    expect((await ok.get('/api/v1/stock/balances')).status).toBe(200);
  });

  it('GET /auth/me returns roles and permissions', async () => {
    const c = await asUser('OWNER');
    const res = await c.get('/api/v1/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.roles).toContain('OWNER');
    expect(res.body.data.permissions).toContain('accounts.bill.approve');
  });

  it('change-password enforces the policy and revokes sessions', async () => {
    const u = await createUser([]);
    const res = await login(u.username, u.password);
    const token = res.body.data.accessToken as string;
    const weak = await request(app)
      .post('/api/v1/auth/change-password')
      .set('authorization', `Bearer ${token}`)
      .send({ currentPassword: u.password, newPassword: 'short' });
    expect(weak.status).toBe(400);
    const ok = await request(app)
      .post('/api/v1/auth/change-password')
      .set('authorization', `Bearer ${token}`)
      .send({ currentPassword: u.password, newPassword: 'New-password-2026' });
    expect(ok.status).toBe(200);
    expect(await prisma.session.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
    expect((await login(u.username, 'New-password-2026')).status).toBe(200);
  });
});
