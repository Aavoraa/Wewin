import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../test/helpers';

describe('Vercel Cron endpoint', () => {
  const before = process.env.CRON_SECRET;
  beforeAll(() => {
    process.env.CRON_SECRET = 'cron-test-secret-0123456789';
  });
  afterAll(() => {
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  });

  it('refuses calls without the secret, runs a known job with it, and rejects unknown jobs', async () => {
    expect((await request(app).get('/api/cron/dc-overdue-check')).status).toBe(401);
    expect((await request(app).get('/api/cron/dc-overdue-check').set('authorization', 'Bearer wrong')).status).toBe(401);
    const ok = await request(app).get('/api/cron/dc-overdue-check').set('authorization', 'Bearer cron-test-secret-0123456789');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({ ok: true, job: 'dc-overdue-check' });
    expect((await request(app).get('/api/cron/refresh-stock-balances').set('authorization', 'Bearer cron-test-secret-0123456789')).status).toBe(404);
  });

  it('is closed when no secret is configured', async () => {
    delete process.env.CRON_SECRET;
    expect((await request(app).get('/api/cron/dc-overdue-check').set('authorization', 'Bearer ')).status).toBe(401);
    process.env.CRON_SECRET = 'cron-test-secret-0123456789';
  });
});
