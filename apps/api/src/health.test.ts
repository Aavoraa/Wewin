import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, dbFingerprint } from './app';

describe('readiness check', () => {
  it('fingerprints the database without revealing it; pooled and direct addresses match', () => {
    const direct = dbFingerprint('postgresql://u:secret@ep-x-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');
    expect(direct).toMatch(/^[0-9a-f]{10}$/);
    expect(dbFingerprint('postgresql://u:other@ep-x-123-pooler.ap-southeast-1.aws.neon.tech/neondb?pgbouncer=true')).toBe(direct);
    expect(dbFingerprint('postgresql://u:secret@ep-x-123.ap-southeast-1.aws.neon.tech/otherdb')).not.toBe(direct);
    expect(dbFingerprint(undefined)).toBeNull();
  });

  it('reports the migrations, the scans table and the file store, and no secrets', async () => {
    const r = await request(createApp()).get('/api/health/ready');
    expect(r.status).toBe(200);
    expect(r.body.setup).toMatchObject({ scansTable: true, fileStorage: 'disk', blobConnected: false });
    expect(r.body.setup.migrations).toBeGreaterThan(0);
    expect(JSON.stringify(r.body)).not.toMatch(/postgres|@|password/i);
  });
});
