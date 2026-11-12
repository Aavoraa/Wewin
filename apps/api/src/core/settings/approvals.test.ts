import { beforeAll, describe, expect, it } from 'vitest';
import { type Client, asUser } from '../../../test/helpers';

let owner: Client;
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

beforeAll(async () => {
  owner = await asUser('OWNER');
});

async function withSetting(key: string, value: boolean, fn: () => Promise<void>) {
  ok(await owner.put(`/api/v1/settings/business/${key}`, { value }));
  try {
    await fn();
  } finally {
    ok(await owner.put(`/api/v1/settings/business/${key}`, { value: true }));
  }
}

describe('approval switches (Q-075)', () => {
  it('QC: while required only qc.approve may approve; switched off, whoever enters checks approves them', async () => {
    const inspector = await asUser(['qc.view', 'qc.create']);
    expect((await inspector.post(`/api/v1/qc/${MISSING_ID}/approve`, { note: 'Checked' })).status).toBe(403);
    await withSetting('qc.approvalRequired', false, async () => {
      // Permission passes at once (cache dropped); the missing record answers 404, not 403.
      expect((await inspector.post(`/api/v1/qc/${MISSING_ID}/approve`, { note: 'Checked' })).status).toBe(404);
      expect((await inspector.get('/api/v1/auth/me')).body.data.permissions).toContain('qc.approve');
    });
    expect((await inspector.post(`/api/v1/qc/${MISSING_ID}/approve`, { note: 'Checked' })).status).toBe(403);
  });

  it('programmes and SPL requests follow their own switches; a viewer never gains them', async () => {
    const merch = await asUser(['programs.view', 'programs.edit', 'trims.view', 'trims.create']);
    const viewer = await asUser(['programs.view', 'trims.view']);
    expect((await merch.post(`/api/v1/programs/${MISSING_ID}/approve`)).status).toBe(403);
    await withSetting('programs.approvalRequired', false, async () => {
      expect((await merch.post(`/api/v1/programs/${MISSING_ID}/approve`)).status).toBe(404);
      expect((await viewer.post(`/api/v1/programs/${MISSING_ID}/approve`)).status).toBe(403);
      expect((await merch.get('/api/v1/auth/me')).body.data.permissions).not.toContain('trims.spl.approve');
    });
    await withSetting('trims.splApprovalRequired', false, async () => {
      expect((await merch.get('/api/v1/auth/me')).body.data.permissions).toContain('trims.spl.approve');
      expect((await viewer.get('/api/v1/auth/me')).body.data.permissions).not.toContain('trims.spl.approve');
    });
  });

  it('purchase order approval is not switchable', async () => {
    const settings = (await owner.get('/api/v1/settings/business')).body.data as { key: string }[];
    expect(settings.map((s) => s.key)).not.toContain('purchase.approvalRequired');
    expect((await owner.put('/api/v1/settings/business/purchase.approvalRequired', { value: false })).status).toBe(404);
  });
});
