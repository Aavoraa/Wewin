import { beforeAll, describe, expect, it } from 'vitest';
import { generateBundles } from '@wewin/shared';
import { prisma, withTx } from '../../core/db';
import { ledger } from '../../core/ledger/ledger.service';
import { type Client, asUser, assertLedgerInvariants, locationId } from '../../../test/helpers';
import { type Masters, createOrder, createProgram, dyedRolls, masters } from '../../../test/fixtures';

let owner: Client;
let m: Masters;
let order: { id: string; orderNo: string };
let rolls: { id: string; rollNo: string; kg: string }[];
let L: Record<string, string>;
let lay: { id: string; docNo: string; bundles: { id: string; bundleNo: string; componentCode: string; size: string; pcs: number }[] };
let pdcOut: { id: string; lines: { id: string; bundleId: string }[] };

const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);
async function bal(itemId: string, loc: string, colour = 'NAVY', size = '2Y') {
  const [b] = await withTx((tx) => ledger.balances(tx, [{ itemId, locationId: loc, lot: '', colour, size }]));
  return Number(b!.qty);
}
async function doc(path: string, body: object) {
  const r = await owner.post(path, body);
  ok(r, 201);
  const p = await owner.post(`${path}/${r.body.data.id}/post`);
  ok(p);
  return p.body.data;
}

beforeAll(async () => {
  owner = await asUser('OWNER');
  m = await masters();
  order = await createOrder(owner, m, { panelCost: '7.5' });
  const program = await createProgram(owner, m, order.id);
  rolls = await dyedRolls(owner, m, program, 'NAVY', ['60', '55']);
  L = {};
  for (const code of ['FABRIC_STORE', 'CUT_STORE', 'SEWING_WIP', 'FINISHING', 'FG_STORE', 'REJECTED', 'PROCESS_LOSS']) L[code] = await locationId(code);
});

describe('cutting', () => {
  it('a lay consumes rolls (one partially) and creates numbered bundles in CUT_STORE', async () => {
    const bundles = generateBundles({
      components: [
        { code: 'FRONT', pcsPerGarment: 1 },
        { code: 'BACK', pcsPerGarment: 1 },
        { code: 'SLEEVE', pcsPerGarment: 2 },
      ],
      sizeRatios: [
        { size: '2Y', ratio: 1 },
        { size: '4Y', ratio: 1 },
      ],
      plies: 20,
      pcsPerBundle: 20,
    });
    expect(bundles).toHaveLength(8);
    lay = await doc('/api/v1/cut-lays', {
      docDate: '2026-10-10',
      orderId: order.id,
      colour: 'NAVY',
      plies: 20,
      pcsPerBundle: 20,
      rolls: [
        { rollId: rolls[0]!.id, kgUsed: '60' },
        { rollId: rolls[1]!.id, kgUsed: '50' },
      ],
      bundles,
    });
    expect(lay.docNo).toMatch(/^CUT\/26-27\/\d{4}$/);
    expect(lay.bundles.every((b) => b.bundleNo.startsWith(`${lay.docNo}-`))).toBe(true);
    expect(await bal(m.items.front.id, L.CUT_STORE!)).toBe(20);
    expect(await bal(m.items.sleeve.id, L.CUT_STORE!, 'NAVY', '4Y')).toBe(40);
    const left = await withTx((tx) => ledger.unitBalanceAt(tx, 'roll', [rolls[0]!.id, rolls[1]!.id], L.FABRIC_STORE!));
    expect(left.get(rolls[0]!.id)).toBe('0.000');
    expect(left.get(rolls[1]!.id)).toBe('5.000');
  });

  it('a roll cannot be cut beyond what it has left', async () => {
    const r = await owner.post('/api/v1/cut-lays', {
      docDate: '2026-10-10',
      orderId: order.id,
      colour: 'NAVY',
      rolls: [{ rollId: rolls[1]!.id, kgUsed: '5.001' }],
      bundles: [{ componentCode: 'FRONT', size: '2Y', pcs: 1 }],
    });
    ok(r, 201);
    const p = await owner.post(`/api/v1/cut-lays/${r.body.data.id}/post`);
    expect(p.status).toBe(409);
    expect(p.body.error.code).toBe('NEGATIVE_STOCK');
    ok(await owner.del(`/api/v1/cut-lays/${r.body.data.id}`), 204);
  });

  it('validates colour, components and roll colour', async () => {
    const base = { docDate: '2026-10-10', orderId: order.id, rolls: [{ rollId: rolls[1]!.id, kgUsed: '1' }] };
    expect((await owner.post('/api/v1/cut-lays', { ...base, colour: 'PINK', bundles: [{ componentCode: 'FRONT', size: '2Y', pcs: 1 }] })).status).toBe(400);
    expect((await owner.post('/api/v1/cut-lays', { ...base, colour: 'NAVY', bundles: [{ componentCode: 'POCKET', size: '2Y', pcs: 1 }] })).status).toBe(400);
    expect((await owner.post('/api/v1/cut-lays', { ...base, colour: 'RED', bundles: [{ componentCode: 'FRONT', size: '2Y', pcs: 1 }] })).status).toBe(400);
  });

  it('bundle scan lookup shows where the bundle is', async () => {
    const b = lay.bundles[0]!;
    const r = await owner.get(`/api/v1/bundles/by-no/${encodeURIComponent(b.bundleNo)}`);
    ok(r);
    expect(r.body.data.at).toEqual([expect.objectContaining({ code: 'CUT_STORE', pcs: b.pcs })]);
  });
});

describe('panel job work', () => {
  const front = (size: string) => lay.bundles.find((b) => b.componentCode === 'FRONT' && b.size === size)!;

  it('sends front bundles to the printer (bundle-level guard against double sending)', async () => {
    pdcOut = await doc('/api/v1/panel-dcs', {
      type: 'OUT',
      docDate: '2026-10-11',
      vendorId: m.vendors.printer.id,
      processId: m.processes.printing.id,
      orderId: order.id,
      lines: [
        { bundleId: front('2Y').id, pcs: 20 },
        { bundleId: front('4Y').id, pcs: 20 },
      ],
    });
    expect(await bal(m.items.front.id, L.CUT_STORE!)).toBe(0);
    expect(await bal(m.items.front.id, m.vendors.printer.locationId)).toBe(20);
    const again = await owner.post('/api/v1/panel-dcs', {
      type: 'OUT',
      docDate: '2026-10-11',
      vendorId: m.vendors.printer.id,
      processId: m.processes.printing.id,
      orderId: order.id,
      lines: [{ bundleId: front('2Y').id, pcs: 20 }],
    });
    ok(again, 201);
    const p = await owner.post(`/api/v1/panel-dcs/${again.body.data.id}/post`);
    expect(p.status).toBe(409);
    expect(p.body.error.code).toBe('NEGATIVE_STOCK');
  });

  it('the lay cannot be cancelled once its bundles have moved', async () => {
    const r = await owner.post(`/api/v1/cut-lays/${lay.id}/cancel`, { reason: 'test' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DOC_HAS_DEPENDENTS');
  });

  it('printer returns good and rejected pieces; over-returns are refused', async () => {
    const out2y = pdcOut.lines.find((l) => l.bundleId === front('2Y').id)!;
    const out4y = pdcOut.lines.find((l) => l.bundleId === front('4Y').id)!;
    const pending = await owner.get(`/api/v1/panel-dcs/pending?vendorId=${m.vendors.printer.id}`);
    expect(pending.body.data.filter((x: { dcId: string }) => x.dcId === pdcOut.id)).toHaveLength(2);
    await doc('/api/v1/panel-dcs', {
      type: 'IN',
      docDate: '2026-10-13',
      vendorId: m.vendors.printer.id,
      lines: [
        { outLineId: out2y.id, goodPcs: 18, rejectedPcs: 1 },
        { outLineId: out4y.id, goodPcs: 20, rejectedPcs: 0 },
      ],
    });
    expect(await bal(m.items.front.id, L.CUT_STORE!)).toBe(18);
    expect(await bal(m.items.front.id, L.REJECTED!)).toBeGreaterThanOrEqual(1);
    const over = await owner.post('/api/v1/panel-dcs', { type: 'IN', docDate: '2026-10-13', vendorId: m.vendors.printer.id, lines: [{ outLineId: out2y.id, goodPcs: 2, rejectedPcs: 0 }] });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('QTY_EXCEEDS_PENDING');
  });

  it('shortfall: missing = sent − good − rejected, valued at the order panel cost', async () => {
    const r = await owner.get(`/api/v1/panel-dcs/${pdcOut.id}`);
    expect(r.body.data.totals).toMatchObject({ sent: 40, good: 38, rejected: 1, missing: 1 });
    expect(r.body.data.shortfall).toMatchObject({ debitPcs: 2, rejectedValue: '7.50', missingValue: '7.50', debitValue: '15.00' });
  });

  it('closing posts the missing pieces to PROCESS_LOSS', async () => {
    const before = await bal(m.items.front.id, L.PROCESS_LOSS!);
    const r = await owner.post(`/api/v1/panel-dcs/${pdcOut.id}/close`, { reason: 'Printing complete' });
    ok(r);
    expect(r.body.data.status).toBe('CLOSED');
    expect((await bal(m.items.front.id, L.PROCESS_LOSS!)) - before).toBe(1);
    expect(await bal(m.items.front.id, m.vendors.printer.locationId)).toBe(0);
  });

  it('recut slip for the rejected / missing pieces (non-stock, numbered)', async () => {
    const r = await doc('/api/v1/recut-slips', {
      docDate: '2026-10-14',
      orderId: order.id,
      panelDcId: pdcOut.id,
      reason: 'Print smudge + 1 missing',
      lines: [{ componentCode: 'FRONT', colour: 'NAVY', size: '2Y', pcs: 2 }],
    });
    expect(r.docNo).toMatch(/^RCS\/26-27\/\d{4}$/);
  });
});

describe('sewing, packing, trims and WIP', () => {
  const b2y = () => lay.bundles.filter((b) => b.size === '2Y');

  it('sewing issue moves bundles to SEWING_WIP; a bundle cannot be issued beyond what it has', async () => {
    const tooMany = await owner.post('/api/v1/sewing-issues', {
      docDate: '2026-10-15',
      orderId: order.id,
      sewingLine: 'Line 1',
      lines: b2y().map((b) => ({ bundleId: b.id, pcs: b.pcs })), // front 2Y bundle now holds 18, not 20
    });
    ok(tooMany, 201);
    const p = await owner.post(`/api/v1/sewing-issues/${tooMany.body.data.id}/post`);
    expect(p.status).toBe(409);
    ok(await owner.del(`/api/v1/sewing-issues/${tooMany.body.data.id}`), 204);
    await doc('/api/v1/sewing-issues', {
      docDate: '2026-10-15',
      orderId: order.id,
      sewingLine: 'Line 1',
      lines: b2y().map((b) => ({ bundleId: b.id, pcs: b.componentCode === 'FRONT' ? 18 : b.pcs })),
    });
    expect(await bal(m.items.front.id, L.SEWING_WIP!)).toBe(18);
    expect(await bal(m.items.sleeve.id, L.SEWING_WIP!)).toBe(40);
  });

  it('sewing output consumes panels per component and creates garments in FINISHING', async () => {
    await doc('/api/v1/sewing-entries', { docDate: '2026-10-16', orderId: order.id, sewingLine: 'Line 1', lines: [{ colour: 'NAVY', size: '2Y', pcs: 18 }] });
    expect(await bal(m.items.garment.id, L.FINISHING!)).toBe(18);
    expect(await bal(m.items.front.id, L.SEWING_WIP!)).toBe(0);
    expect(await bal(m.items.sleeve.id, L.SEWING_WIP!)).toBe(4); // 40 − 18 × 2
    const more = await owner.post('/api/v1/sewing-entries', { docDate: '2026-10-16', orderId: order.id, sewingLine: 'Line 1', lines: [{ colour: 'NAVY', size: '2Y', pcs: 1 }] });
    ok(more, 201);
    const p = await owner.post(`/api/v1/sewing-entries/${more.body.data.id}/post`);
    expect(p.status).toBe(409);
    expect(p.body.error.code).toBe('NEGATIVE_STOCK');
  });

  let carton: { id: string; docNo: string; cartonSeq: number };
  it('cartons move garments FINISHING → FG_STORE with a carton sequence per order', async () => {
    carton = await doc('/api/v1/cartons', { docDate: '2026-10-17', orderId: order.id, grossKg: '6.2', netKg: '5.4', lines: [{ colour: 'NAVY', size: '2Y', pcs: 12 }] });
    expect(carton.cartonSeq).toBe(1);
    expect(carton.docNo).toMatch(/^CTN\/26-27\/\d{4}$/);
    expect(await bal(m.items.garment.id, L.FG_STORE!)).toBe(12);
    const over = await owner.post('/api/v1/cartons', { docDate: '2026-10-17', orderId: order.id, lines: [{ colour: 'NAVY', size: '2Y', pcs: 7 }] });
    ok(over, 201);
    expect((await owner.post(`/api/v1/cartons/${over.body.data.id}/post`)).status).toBe(409);
  });

  it('packing list reserves cartons; a listed carton cannot be cancelled', async () => {
    const pl = await doc('/api/v1/packing-lists', { docDate: '2026-10-18', orderId: order.id, cartonIds: [carton.id] });
    expect(pl.totals).toMatchObject({ cartons: 1, pcs: 12 });
    const c = await owner.post(`/api/v1/cartons/${carton.id}/cancel`, { reason: 'test' });
    expect(c.status).toBe(409);
    const dup = await owner.post('/api/v1/packing-lists', { docDate: '2026-10-18', orderId: order.id, cartonIds: [carton.id] });
    expect(dup.status).toBe(409);
  });

  it('trims receipt and issue against the order', async () => {
    await doc('/api/v1/trims-docs', { type: 'RECEIPT', docDate: '2026-10-12', vendorId: m.vendors.mill.id, lines: [{ itemId: m.items.label.id, qty: '2000', rate: '0.85' }] });
    await doc('/api/v1/trims-docs', { type: 'ISSUE', docDate: '2026-10-15', orderId: order.id, lines: [{ itemId: m.items.label.id, qty: '1500' }] });
    const r = await owner.post('/api/v1/trims-docs', { type: 'ISSUE', docDate: '2026-10-15', orderId: order.id, lines: [{ itemId: m.items.label.id, qty: '0.5' }] });
    ok(r, 201);
    expect((await owner.post(`/api/v1/trims-docs/${r.body.data.id}/post`)).status).toBe(400); // NOS must be whole
    expect((await owner.post('/api/v1/trims-docs', { type: 'ISSUE', docDate: '2026-10-15', lines: [{ itemId: m.items.label.id, qty: '1' }] })).status).toBe(400);
  });

  it('order WIP shows each stage against the PO', async () => {
    const r = await owner.get(`/api/v1/orders/${order.id}/wip`);
    ok(r);
    const s = Object.fromEntries(r.body.data.stages.map((x: { key: string; qty: string }) => [x.key, x.qty]));
    expect(s).toMatchObject({ cut: '40', sewn: '18', packed: '12', shipped: '0', fabricCut: '110.000', dyed: '115.000' });
    expect(r.body.data.poPcs).toBe(1500);
    const cell = r.body.data.cells.find((c: { colour: string; size: string }) => c.colour === 'NAVY' && c.size === '2Y');
    expect(cell).toMatchObject({ po: 100, cutSets: 20, sewn: 18, packed: 12 });
    await assertLedgerInvariants();
  });

  it('permissions on production documents', async () => {
    const sup = await asUser(['cutting.view', 'sewing.view']);
    expect((await sup.get('/api/v1/cut-lays')).status).toBe(200);
    expect((await sup.post('/api/v1/sewing-entries', {})).status).toBe(403);
    expect((await sup.get('/api/v1/cartons')).status).toBe(403);
    expect(await prisma.cutBundle.count({ where: { layId: lay.id } })).toBe(8);
  });
});
