import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTx } from '../../core/db';
import { ledger } from '../../core/ledger/ledger.service';
import { type Client, asUser, locationId } from '../../../test/helpers';
import { type Masters, createOrder, createProgram, masters, orderBody } from '../../../test/fixtures';

let owner: Client;
let m: Masters;

beforeAll(async () => {
  owner = await asUser('OWNER');
  m = await masters();
});

describe('orders', () => {
  it('creates a draft order with a 3 × 5 matrix and totals', async () => {
    const res = await owner.post('/api/v1/orders', orderBody(m));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'DRAFT', colours: ['NAVY', 'RED', 'WHITE'] });
    expect(res.body.data.lines).toHaveLength(15);
    expect(res.body.data.totals).toMatchObject({ pcs: 1500, value: '4875.00', fullyPriced: true, byColour: { NAVY: 500 } });
    const lines = await owner.get(`/api/v1/orders/${res.body.data.id}/lines`);
    expect(lines.body.data.totals.bySize['2Y']).toBe(300);
  });

  it('validates the style item type and matrix', async () => {
    const bad = await owner.post('/api/v1/orders', orderBody(m, { garmentItemId: m.items.yarn.id }));
    expect(bad.status).toBe(400);
    const cell = await owner.post('/api/v1/orders', orderBody(m, { lines: [{ colour: 'PINK', size: '2Y', qty: 5 }] }));
    expect(cell.status).toBe(400);
  });

  it('enforces the order lifecycle: confirm, amend matrix, lock components, close', async () => {
    const o = (await owner.post('/api/v1/orders', orderBody(m))).body.data;
    expect((await owner.post(`/api/v1/orders/${o.id}/close`, { reason: 'too early' })).status).toBe(409);
    const conf = await owner.post(`/api/v1/orders/${o.id}/confirm`);
    expect(conf.status).toBe(200);
    expect(conf.body.data.status).toBe('CONFIRMED');
    expect((await owner.post(`/api/v1/orders/${o.id}/confirm`)).status).toBe(409);

    // PO amendment on a confirmed order: quantities may change (audited)…
    const body = orderBody(m, { orderNo: o.orderNo, buyerPoNo: o.buyerPoNo });
    body.lines[0]!.qty = 120;
    const amend = await owner.patch(`/api/v1/orders/${o.id}`, { ...body, version: conf.body.data.version });
    expect(amend.status, JSON.stringify(amend.body)).toBe(200);
    expect(amend.body.data.totals.pcs).toBe(1520);
    // …but components are locked.
    const comp = await owner.patch(`/api/v1/orders/${o.id}`, {
      ...body,
      components: body.components.slice(0, 2),
      version: amend.body.data.version,
    });
    expect(comp.status).toBe(409);
    // Stale version
    expect((await owner.patch(`/api/v1/orders/${o.id}`, { ...body, version: conf.body.data.version })).status).toBe(409);

    const closed = await owner.post(`/api/v1/orders/${o.id}/close`, { reason: 'Shipped complete' });
    expect(closed.body.data.status).toBe('CLOSED');
    expect((await owner.patch(`/api/v1/orders/${o.id}`, { ...body, version: closed.body.data.version })).status).toBe(409);
    const auditRows = await prisma.auditLog.findMany({ where: { recordId: o.id, tableName: 'ORDER' } });
    expect(auditRows.map((a) => a.action).sort()).toEqual(['CLOSE', 'CONFIRM']);
    expect(auditRows.find((a) => a.action === 'CLOSE')?.reason).toBe('Shipped complete');
  });

  it('refuses cancellation once stock documents reference the order', async () => {
    const o = await createOrder(owner, m);
    const [sup, store] = [await locationId('SUPPLIER'), await locationId('YARN_STORE')];
    await withTx((tx) =>
      ledger.post(tx, { type: 'TEST', id: crypto.randomUUID(), docDate: '2026-10-12' }, [
        { itemId: m.items.yarn.id, qty: '10', unit: 'KG', fromLocationId: sup, toLocationId: store, lineKey: 'a', orderId: o.id },
      ], owner.userId),
    );
    const res = await owner.post(`/api/v1/orders/${o.id}/cancel`, { reason: 'Buyer dropped' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DOC_HAS_DEPENDENTS');
    const free = await createOrder(owner, m);
    expect((await owner.post(`/api/v1/orders/${free.id}/cancel`, { reason: 'Buyer dropped' })).body.data.status).toBe('CANCELLED');
  });

  it('cancel requires a reason; drafts can be deleted', async () => {
    const o = await createOrder(owner, m, { confirm: false });
    expect((await owner.post(`/api/v1/orders/${o.id}/cancel`, {})).status).toBe(400);
    expect((await owner.del(`/api/v1/orders/${o.id}`)).status).toBe(204);
    expect(await prisma.order.findUnique({ where: { id: o.id } })).toBeNull();
  });

  it('saves the costing sheet (panel cost per piece) with permission check', async () => {
    const o = await createOrder(owner, m);
    const res = await owner.put(`/api/v1/orders/${o.id}/costing`, {
      panelCostPerPiece: '6.5',
      fobPerPiece: '3.25',
      lines: [{ head: 'Fabric', basis: 'KG', consumption: '0.18', rate: '420' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.panelCostPerPiece).toBe('6.5');
    expect(res.body.data.lines).toHaveLength(1);
    const merch = await asUser(['orders.view']);
    expect((await merch.put(`/api/v1/orders/${o.id}/costing`, { panelCostPerPiece: '1' })).status).toBe(403);
  });

  it('lists with search, status filter and total pieces; order search for the top bar', async () => {
    const o = await createOrder(owner, m);
    const res = await owner.get(`/api/v1/orders?q=${o.orderNo}&status=CONFIRMED`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].totalPcs).toBe(1500);
    const s = await owner.get(`/api/v1/orders/search?q=${o.orderNo.slice(0, 6)}`);
    expect(s.body.data.some((r: { id: string }) => r.id === o.id)).toBe(true);
  });
});

describe('fabric programs', () => {
  it('creates, edits and approves a program; approved loss limits are locked', async () => {
    const o = await createOrder(owner, m);
    const p = await createProgram(owner, m, o.id, { approve: false });
    expect(p.programNo).toBe(`${o.orderNo}/P1`);
    const got = (await owner.get(`/api/v1/programs/${p.id}`)).body.data;
    expect(got.processes.map((x: { allowedLossPct: string }) => x.allowedLossPct)).toEqual(['2', '8', '1']);
    expect(got.processes[2].plannedOutputKg).toBe('500.000');
    const appr = await owner.post(`/api/v1/programs/${p.id}/approve`);
    expect(appr.body.data.status).toBe('APPROVED');
    const edit = await owner.patch(`/api/v1/programs/${p.id}`, {
      fabricItemId: m.items.dyed.id,
      requiredKg: '600',
      processes: [{ sequence: 1, processId: m.processes.knitting.id, inputItemId: m.items.yarn.id, outputItemId: m.items.greige.id, allowedLossPct: '5' }],
      version: appr.body.data.version,
    });
    expect(edit.status).toBe(409);
  });

  it('rejects piece-stage processes, non-fabric targets and duplicate sequences', async () => {
    const o = await createOrder(owner, m);
    const base = { orderId: o.id, fabricItemId: m.items.dyed.id, requiredKg: '100' };
    const row = { sequence: 1, processId: m.processes.knitting.id, inputItemId: m.items.yarn.id, outputItemId: m.items.greige.id, allowedLossPct: '2' };
    expect((await owner.post('/api/v1/programs', { ...base, processes: [{ ...row, processId: m.processes.printing.id }] })).status).toBe(400);
    expect((await owner.post('/api/v1/programs', { ...base, fabricItemId: m.items.yarn.id, processes: [row] })).status).toBe(400);
    expect((await owner.post('/api/v1/programs', { ...base, processes: [row, row] })).status).toBe(400);
    expect((await owner.post('/api/v1/programs', { ...base, processes: [{ ...row, allowedLossPct: '120' }] })).status).toBe(400);
  });

  it('approval requires programs.approve and an open order', async () => {
    const o = await createOrder(owner, m);
    const p = await createProgram(owner, m, o.id, { approve: false });
    const merch = await asUser(['programs.view', 'programs.edit']);
    expect((await merch.post(`/api/v1/programs/${p.id}/approve`)).status).toBe(403);
    await owner.post(`/api/v1/orders/${o.id}/close`, { reason: 'test' });
    expect((await owner.post(`/api/v1/programs/${p.id}/approve`)).status).toBe(409);
  });

  it('an order with an approved program cannot be cancelled until the program is cancelled', async () => {
    const o = await createOrder(owner, m);
    const p = await createProgram(owner, m, o.id);
    expect((await owner.post(`/api/v1/orders/${o.id}/cancel`, { reason: 'x-test' })).status).toBe(409);
    expect((await owner.post(`/api/v1/programs/${p.id}/cancel`, { reason: 'x-test' })).body.data.status).toBe('CANCELLED');
    expect((await owner.post(`/api/v1/orders/${o.id}/cancel`, { reason: 'x-test' })).status).toBe(200);
  });
});

describe('trims BOM', () => {
  it('stores BOM lines per order and computes requirements with wastage', async () => {
    const o = await createOrder(owner, m);
    const res = await owner.put(`/api/v1/orders/${o.id}/trims-bom`, {
      lines: [
        { trimItemId: m.items.label.id, qtyPerGarment: '1', wastagePct: '3' },
        { trimItemId: m.items.polybag.id, colour: 'NAVY', qtyPerGarment: '1', wastagePct: '0' },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const label = res.body.data.find((l: { trimItemId: string }) => l.trimItemId === m.items.label.id);
    expect(label.requirement).toEqual({ garments: 1500, required: '1545.0000', rounded: '1545' });
    const bag = res.body.data.find((l: { trimItemId: string }) => l.trimItemId === m.items.polybag.id);
    expect(bag.requirement.garments).toBe(500);
    expect((await owner.put(`/api/v1/orders/${o.id}/trims-bom`, { lines: [{ trimItemId: m.items.yarn.id, qtyPerGarment: '1' }] })).status).toBe(400);
    expect((await owner.put(`/api/v1/orders/${o.id}/trims-bom`, { lines: [{ trimItemId: m.items.label.id, colour: 'PINK', qtyPerGarment: '1' }] })).status).toBe(400);
  });
});
