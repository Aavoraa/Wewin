import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTx } from '../../core/db';
import { ledger } from '../../core/ledger/ledger.service';
import { type Client, approveLay, asUser, assertLedgerInvariants, locationId, passFinalQc, uid } from '../../../test/helpers';
import { type Masters, createOrder, createProgram, dyedRolls, masters } from '../../../test/fixtures';

let owner: Client;
let supervisor: Client; // creates lays and QC checks, cannot approve either
let m: Masters;
let order: { id: string; orderNo: string };
let rolls: { id: string; rollNo: string; kg: string }[];
let L: Record<'FINISHING' | 'PRODUCTION' | 'FABRIC_STORE' | 'CUT_STORE' | 'CONSUMED', string>;
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);

const layBody = (rollId: string, kgUsed: string, pcs = 10) => ({
  docDate: '2026-10-20',
  orderId: order.id,
  colour: 'NAVY',
  plies: 10,
  pcsPerBundle: 10,
  rolls: [{ rollId, kgUsed }],
  bundles: [
    { componentCode: 'FRONT', size: '2Y', pcs },
    { componentCode: 'BACK', size: '2Y', pcs },
  ],
});

/** Garments in FINISHING for the order (test seed through the real ledger). */
async function finished(cells: { colour: string; size: string; pcs: number }[]) {
  await withTx((tx) =>
    ledger.post(
      tx,
      { type: 'TEST_SEED', id: randomUUID(), docDate: '2026-10-20' },
      cells.map((c, i) => ({ itemId: m.items.garment.id, qty: String(c.pcs), unit: 'PCS' as const, colour: c.colour, size: c.size, orderId: order.id, fromLocationId: L.PRODUCTION, toLocationId: L.FINISHING, lineKey: String(i) })),
      owner.userId,
    ),
  );
}

beforeAll(async () => {
  owner = await asUser('OWNER');
  supervisor = await asUser(['cutting.view', 'cutting.create', 'cutting.post', 'qc.view', 'qc.create', 'stock.view', 'packing.view', 'packing.create', 'packing.post']);
  m = await masters();
  order = await createOrder(owner, m, { panelCost: '7.5' });
  const program = await createProgram(owner, m, order.id);
  rolls = await dyedRolls(owner, m, program, 'NAVY', ['40', '40', '40', '40']);
  L = {
    FINISHING: await locationId('FINISHING'),
    PRODUCTION: await locationId('PRODUCTION'),
    FABRIC_STORE: await locationId('FABRIC_STORE'),
    CUT_STORE: await locationId('CUT_STORE'),
    CONSUMED: await locationId('CONSUMED'),
  };
});

describe('cutting lay approval (Q-062)', () => {
  it('create → post refused → approve (permission checked) → post → movements → cancel → reversal', async () => {
    const created = await supervisor.post('/api/v1/cut-lays', layBody(rolls[0]!.id, '20'));
    ok(created, 201);
    const id = created.body.data.id as string;
    expect(created.body.data.approvalStatus).toBe('PENDING');
    expect(await prisma.notification.count({ where: { eventKey: `LAY_APPROVAL:${id}:1` } })).toBeGreaterThan(0);

    const early = await supervisor.post(`/api/v1/cut-lays/${id}/post`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('APPROVAL_REQUIRED');
    expect((await supervisor.post(`/api/v1/cut-lays/${id}/approve`, { note: 'Self approval' })).status).toBe(403);
    expect((await owner.post(`/api/v1/cut-lays/${id}/approve`, { note: '' })).status).toBe(400); // a note is required

    const approved = await approveLay(owner, id);
    expect(approved).toMatchObject({ approvalStatus: 'APPROVED', approvalNote: 'Marker and rolls checked', approvedBy: { id: owner.userId } });
    expect((await owner.post(`/api/v1/cut-lays/${id}/approve`, { note: 'Twice' })).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { recordId: id, action: 'APPROVE', reason: 'Marker and rolls checked' } })).toBe(1);

    const posted = await supervisor.post(`/api/v1/cut-lays/${id}/post`);
    ok(posted);
    expect(posted.body.data.docNo).toMatch(/^CUT\/26-27\/\d{4}$/);
    const moves = await prisma.stockMovement.findMany({ where: { sourceType: 'CUT_LAY', sourceId: id } });
    expect(moves.filter((x) => x.fromLocationId === L.FABRIC_STORE && x.toLocationId === L.CONSUMED)).toHaveLength(1);
    expect(moves.filter((x) => x.toLocationId === L.CUT_STORE)).toHaveLength(2);
    expect((await owner.post(`/api/v1/cut-lays/${id}/post`)).body.error.code).toBe('DOC_ALREADY_POSTED');

    ok(await owner.post(`/api/v1/cut-lays/${id}/cancel`, { reason: 'Wrong marker' }));
    expect(await prisma.stockMovement.count({ where: { sourceType: 'CUT_LAY', sourceId: id, isReversal: true } })).toBe(3);
    await assertLedgerInvariants();
  });

  it('editing an approved draft clears the approval and asks again', async () => {
    const created = await supervisor.post('/api/v1/cut-lays', layBody(rolls[1]!.id, '10'));
    const id = created.body.data.id as string;
    const approved = await approveLay(owner, id);
    const edited = await supervisor.patch(`/api/v1/cut-lays/${id}`, { ...layBody(rolls[1]!.id, '12'), version: approved.version });
    ok(edited);
    expect(edited.body.data).toMatchObject({ approvalStatus: 'PENDING', approvedAt: null, approvalNote: null });
    expect(await prisma.notification.count({ where: { eventKey: `LAY_APPROVAL:${id}:${edited.body.data.version}` } })).toBeGreaterThan(0);
    expect((await supervisor.post(`/api/v1/cut-lays/${id}/post`)).body.error.code).toBe('APPROVAL_REQUIRED');
    ok(await owner.del(`/api/v1/cut-lays/${id}`), 204);
  });

  it('can be switched off with the cutting.layApprovalRequired setting', async () => {
    const key = '/api/v1/settings/business/cutting.layApprovalRequired';
    ok(await owner.put(key, { value: false }));
    try {
      const created = await supervisor.post('/api/v1/cut-lays', layBody(rolls[1]!.id, '5'));
      expect(created.body.data.approvalStatus).toBe('NOT_REQUIRED');
      ok(await supervisor.post(`/api/v1/cut-lays/${created.body.data.id}/post`));
    } finally {
      ok(await owner.put(key, { value: true }));
    }
  });

  it('pending lays appear in the approver’s task list', async () => {
    const created = await supervisor.post('/api/v1/cut-lays', layBody(rolls[1]!.id, '3'));
    const tasks = await owner.get('/api/v1/dashboard/tasks');
    ok(tasks);
    expect(tasks.body.data.tasks).toContainEqual(expect.objectContaining({ kind: 'CUT_LAY', action: 'Approve', to: `/cut-lays/${created.body.data.id}` }));
    const mine = await supervisor.get('/api/v1/dashboard/tasks');
    expect(mine.status).toBe(403); // no dashboard.view
    ok(await owner.del(`/api/v1/cut-lays/${created.body.data.id}`), 204);
  });
});

describe('fabric roll inspection (Q-063)', () => {
  it('a roll on hold cannot be cut; a later pass releases it', async () => {
    const roll = rolls[2]!;
    const hold = await supervisor.post('/api/v1/qc', { kind: 'FABRIC_ROLL', docDate: '2026-10-20', inspector: 'Selvi', lines: [{ rollId: roll.id, result: 'HOLD', gsm: 171, defectPoints: 46, defects: [{ code: 'Shade variation', count: 3 }] }] });
    ok(hold, 201);
    expect((await supervisor.post(`/api/v1/qc/${hold.body.data.id}/approve`, { note: 'Held' })).status).toBe(403);
    const a = await owner.post(`/api/v1/qc/${hold.body.data.id}/approve`, { note: 'Held for shade check' });
    ok(a);
    expect(a.body.data.docNo).toMatch(/^QC\/26-27\/\d{4}$/);
    expect((await owner.post(`/api/v1/qc/${hold.body.data.id}/approve`, { note: 'again' })).body.error.code).toBe('DOC_ALREADY_POSTED');

    const blocked = await supervisor.post('/api/v1/cut-lays', layBody(roll.id, '10'));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('QC_BLOCKED');
    const status = await supervisor.get(`/api/v1/qc/roll-status?ids=${roll.id}`);
    expect(status.body.data[roll.id]).toMatchObject({ result: 'HOLD' });

    const pass = await supervisor.post('/api/v1/qc', { kind: 'FABRIC_ROLL', docDate: '2026-10-21', lines: [{ rollId: roll.id, result: 'PASS', gsm: 180 }] });
    ok(await owner.post(`/api/v1/qc/${pass.body.data.id}/approve`, { note: 'Shade accepted by buyer' }));
    ok(await supervisor.post('/api/v1/cut-lays', layBody(roll.id, '10')), 201);
  });

  it('with qc.fabricInspectionRequired, uninspected rolls cannot be cut either', async () => {
    const key = '/api/v1/settings/business/qc.fabricInspectionRequired';
    ok(await owner.put(key, { value: true }));
    try {
      const r = await supervisor.post('/api/v1/cut-lays', layBody(rolls[3]!.id, '10'));
      expect(r.status).toBe(409);
      expect(r.body.error.message).toContain('not inspected');
    } finally {
      ok(await owner.put(key, { value: false }));
    }
  });

  it('validates the lines: result needed, roll once, defects from the list', async () => {
    const base = { kind: 'FABRIC_ROLL', docDate: '2026-10-20' };
    expect((await supervisor.post('/api/v1/qc', { ...base, lines: [{ rollId: rolls[3]!.id }] })).status).toBe(400);
    expect((await supervisor.post('/api/v1/qc', { ...base, lines: [{ rollId: rolls[3]!.id, result: 'PASS' }, { rollId: rolls[3]!.id, result: 'HOLD' }] })).status).toBe(400);
    const bad = await supervisor.post('/api/v1/qc', { ...base, lines: [{ rollId: rolls[3]!.id, result: 'REJECT', defects: [{ code: 'Made-up defect', count: 1 }] }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('defect list');
  });
});

describe('final inspection and the packing gate (Q-063)', () => {
  it('only pieces passed in an approved final inspection can be packed', async () => {
    await finished([{ colour: 'NAVY', size: '4Y', pcs: 30 }]);
    const carton = await supervisor.post('/api/v1/cartons', { docDate: '2026-10-21', orderId: order.id, lines: [{ colour: 'NAVY', size: '4Y', pcs: 10 }] });
    ok(carton, 201);
    const refused = await supervisor.post(`/api/v1/cartons/${carton.body.data.id}/post`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('QC_BLOCKED');

    // More checked than are in finishing → refused at approval.
    const tooMany = await supervisor.post('/api/v1/qc', { kind: 'FINAL', docDate: '2026-10-21', orderId: order.id, lines: [{ colour: 'NAVY', size: '4Y', checkedPcs: 31, passedPcs: 31, rejectedPcs: 0 }] });
    ok(tooMany, 201);
    const tm = await owner.post(`/api/v1/qc/${tooMany.body.data.id}/approve`, { note: 'Looks fine' });
    expect(tm.body.error.code, JSON.stringify(tm.body)).toBe('QTY_EXCEEDS_PENDING');
    ok(await supervisor.del(`/api/v1/qc/${tooMany.body.data.id}`), 204);

    const fin = await supervisor.post('/api/v1/qc', {
      kind: 'FINAL',
      docDate: '2026-10-21',
      orderId: order.id,
      inspector: 'Karthik',
      lines: [{ colour: 'NAVY', size: '4Y', checkedPcs: 12, passedPcs: 11, rejectedPcs: 1, defects: [{ code: 'Open seam', count: 1 }] }],
    });
    ok(fin, 201);
    expect(fin.body.data.totals).toMatchObject({ checked: 12, passed: 11, rejected: 1, defectPct: '8.3' });
    ok(await owner.post(`/api/v1/qc/${fin.body.data.id}/approve`, { note: 'AQL 2.5 passed' }));

    ok(await supervisor.post(`/api/v1/cartons/${carton.body.data.id}/post`)); // 10 of 11 passed
    const second = await supervisor.post('/api/v1/cartons', { docDate: '2026-10-21', orderId: order.id, lines: [{ colour: 'NAVY', size: '4Y', pcs: 2 }] });
    const over = await supervisor.post(`/api/v1/cartons/${second.body.data.id}/post`);
    expect(over.body.error.code).toBe('QC_BLOCKED');
    expect(over.body.error.message).toContain('1 left');

    // The inspection now covers packed pieces: it cannot be cancelled.
    const cancel = await owner.post(`/api/v1/qc/${fin.body.data.id}/cancel`, { reason: 'Re-inspect' });
    expect(cancel.status).toBe(409);
    expect(cancel.body.error.code).toBe('DOC_HAS_DEPENDENTS');
    expect((await owner.get(`/api/v1/qc/${fin.body.data.id}`)).body.data.status).toBe('POSTED');
  });

  it('validates final lines: passed + rejected = checked, colour / size on the order', async () => {
    const base = { kind: 'FINAL', docDate: '2026-10-21', orderId: order.id };
    expect((await supervisor.post('/api/v1/qc', { ...base, lines: [{ colour: 'NAVY', size: '2Y', checkedPcs: 10, passedPcs: 8, rejectedPcs: 1 }] })).status).toBe(400);
    expect((await supervisor.post('/api/v1/qc', { ...base, lines: [{ colour: 'PINK', size: '2Y', checkedPcs: 10, passedPcs: 10, rejectedPcs: 0 }] })).status).toBe(400);
    expect((await supervisor.post('/api/v1/qc', { ...base, orderId: null, lines: [{ colour: 'NAVY', size: '2Y', checkedPcs: 1, passedPcs: 1 }] })).status).toBe(400);
  });

  it('inline checks record defects per operator without touching stock', async () => {
    const before = await prisma.stockMovement.count();
    const q = await supervisor.post('/api/v1/qc', {
      kind: 'INLINE',
      docDate: '2026-10-21',
      orderId: order.id,
      sewingLine: 'Line 2',
      lines: [
        { operator: 'M-07 overlock', colour: 'NAVY', size: '2Y', checkedPcs: 30, rejectedPcs: 2, defects: [{ code: 'Skip stitch', count: 2 }] },
        { operator: 'M-11 flatlock', checkedPcs: 20, rejectedPcs: 0 },
      ],
    });
    ok(q, 201);
    expect(q.body.data.totals).toMatchObject({ checked: 50, rejected: 2, defectPct: '4.0' });
    ok(await owner.post(`/api/v1/qc/${q.body.data.id}/approve`, { note: 'Line 2 morning check' }));
    expect(await prisma.stockMovement.count()).toBe(before);
    const sum = await supervisor.get('/api/v1/qc/summary?days=365');
    expect(sum.body.data.defects).toContainEqual(expect.objectContaining({ kind: 'INLINE', code: 'Skip stitch' }));
    expect((await supervisor.post('/api/v1/qc', { kind: 'INLINE', docDate: '2026-10-21', orderId: order.id, lines: [{ checkedPcs: 5 }] })).status).toBe(400); // line needed
  });

  it('helper: a passed inspection lets the same pieces be packed', async () => {
    await finished([{ colour: 'NAVY', size: '6Y', pcs: 5 }]);
    await passFinalQc(owner, order.id, [{ colour: 'NAVY', size: '6Y', pcs: 5 }], '2026-10-21');
    const c = await supervisor.post('/api/v1/cartons', { docDate: '2026-10-21', orderId: order.id, lines: [{ colour: 'NAVY', size: '6Y', pcs: 5 }] });
    ok(await supervisor.post(`/api/v1/cartons/${c.body.data.id}/post`));
    await assertLedgerInvariants();
  });
});

describe('accounts feed (Q-064)', () => {
  it('a posting notifies the accounts role with what moved; email is recorded as not set up', async () => {
    const accountant = await prisma.user.create({
      data: {
        username: uid('acc').toLowerCase(),
        fullName: 'Test Accountant',
        email: 'accounts@example.test',
        passwordHash: 'x',
        roles: { create: [{ role: { connect: { code: 'ACCOUNTANT' } } }] },
      },
    });
    const created = await supervisor.post('/api/v1/cut-lays', layBody(rolls[3]!.id, '7.5'));
    const id = created.body.data.id as string;
    await approveLay(owner, id);
    ok(await supervisor.post(`/api/v1/cut-lays/${id}/post`));

    const notes = await prisma.notification.findMany({ where: { userId: accountant.id, kind: 'ACCOUNTS_FEED' }, include: { deliveries: true } });
    const posted = notes.find((n) => n.eventKey === `FEED:CUT_LAY:${id}:POST`);
    expect(posted, JSON.stringify(notes.map((n) => n.eventKey))).toBeDefined();
    expect(posted!.title).toMatch(/^Cutting lay CUT\/26-27\/\d{4} posted$/);
    expect(posted!.body).toContain(`Order ${order.orderNo}`);
    expect(posted!.body).toContain('7.500 kg');
    expect(posted!.link).toBe(`/cut-lays/${id}`);
    expect(posted!.deliveries).toContainEqual(expect.objectContaining({ channel: 'EMAIL', status: 'SKIPPED_NOT_CONFIGURED' }));
    expect(notes.some((n) => n.eventKey === `FEED:CUT_LAY:${id}:APPROVE` && n.body.includes('Note: Marker and rolls checked'))).toBe(true);
    // The supervisor (not an accounts role) gets nothing from the feed.
    expect(await prisma.notification.count({ where: { userId: supervisor.userId, kind: 'ACCOUNTS_FEED' } })).toBe(0);
  });

  it('can be switched off', async () => {
    const key = '/api/v1/settings/business/accounts.feedEnabled';
    ok(await owner.put(key, { value: false }));
    try {
      const created = await supervisor.post('/api/v1/cut-lays', layBody(rolls[1]!.id, '1'));
      await approveLay(owner, created.body.data.id);
      expect(await prisma.notification.count({ where: { eventKey: { startsWith: `FEED:CUT_LAY:${created.body.data.id}` } } })).toBe(0);
      ok(await owner.del(`/api/v1/cut-lays/${created.body.data.id}`), 204);
    } finally {
      ok(await owner.put(key, { value: true }));
    }
  });
});
