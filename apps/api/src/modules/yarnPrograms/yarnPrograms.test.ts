import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../core/db';
import { type Client, approveOutward, asUser, assertLedgerInvariants, locationId, uid } from '../../../test/helpers';
import { type Masters, createOrder, createProgram, masters } from '../../../test/fixtures';

let owner: Client;
let m: Masters;
let order: { id: string; orderNo: string };
let yarnDyeing: { id: string };
let twisting: { id: string };
let dyer: { id: string };
let dyedYarn: { id: string };
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);

/** Kg of an item + lot at a location, from the ledger. */
async function kgAt(itemId: string, lot: string, location: string) {
  const loc = await locationId(location);
  const rows = await prisma.stockMovement.findMany({ where: { itemId, lot, OR: [{ toLocationId: loc }, { fromLocationId: loc }] }, select: { qty: true, toLocationId: true } });
  return rows.reduce((a, r) => (r.toLocationId === loc ? a + Number(r.qty) : a - Number(r.qty)), 0).toFixed(3);
}

const programBody = (over: Record<string, unknown> = {}) => ({
  orderId: order.id,
  processId: yarnDyeing.id,
  outputItemId: dyedYarn.id,
  outputColour: 'NAVY',
  requiredKg: '100',
  allowedLossPct: '4',
  materialCostPerKg: '280',
  inputs: [{ itemId: m.items.yarn.id, mixPct: '100' }],
  ...over,
});

beforeAll(async () => {
  owner = await asUser('OWNER');
  m = await masters();
  order = await createOrder(owner, m);
  const proc = (code: string) => prisma.process.upsert({ where: { code }, create: { code, name: code, stage: 'KG', defaultReturnDays: 20 }, update: {} });
  yarnDyeing = await proc('YARN_DYEING');
  twisting = await proc('YARN_TWISTING');
  const v = await prisma.vendor.create({ data: { code: uid('V'), name: 'Yarn Dyer', creditDays: 30 } });
  await prisma.location.create({ data: { code: `V-${v.code}`, name: v.name, kind: 'VENDOR', vendorId: v.id } });
  await prisma.vendorProcess.create({ data: { vendorId: v.id, processId: yarnDyeing.id } });
  dyer = v;
  dyedYarn = await prisma.item.create({ data: { code: uid('YRN'), name: '30s Dyed Navy', type: 'YARN', unit: 'KG' } });
});

describe('Program Defined — yarn programmes (Q-074)', () => {
  it('validates the mix, numbers per order, plans the kg to send, and only yarn processes', async () => {
    ok(await owner.post('/api/v1/yarn-programs', programBody({ inputs: [{ itemId: m.items.yarn.id, mixPct: '96' }] })), 400); // mix ≠ 100
    ok(await owner.post('/api/v1/yarn-programs', programBody({ outputItemId: m.items.dyed.id })), 400); // output must be yarn
    ok(await owner.post('/api/v1/yarn-programs', programBody({ processId: m.processes.knitting.id })), 400); // not a yarn process
    const twist = await owner.post('/api/v1/yarn-programs', programBody({
      processId: twisting.id,
      requiredKg: '50',
      allowedLossPct: '2',
      inputs: [{ itemId: m.items.yarn.id, mixPct: '96' }, { itemId: m.items.lycra.id, mixPct: '4' }],
    }));
    ok(twist, 201);
    // 50 ÷ 0.98 = 51.0204 split 96 / 4 → 48.980 + 2.041; the total is the sum of the rows sent.
    expect(twist.body.data).toMatchObject({ programNo: `${order.orderNo}/Y1`, status: 'DRAFT', sendKg: '51.021' });
    expect(twist.body.data.inputs.map((l: { planKg: string }) => l.planKg)).toEqual(['48.980', '2.041']);
    ok(await owner.del(`/api/v1/yarn-programs/${twist.body.data.id}`), 204);
  });

  it('approve (permission checked) → deliver only under it → yarn back to the yarn store → close; cancel guarded', async () => {
    const created = await owner.post('/api/v1/yarn-programs', programBody());
    ok(created, 201);
    const yp = created.body.data;
    expect(yp.sendKg).toBe('104.167');

    const lot = uid('L');
    const receipt = await owner.post('/api/v1/yarn-receipts', { docDate: '2026-10-01', vendorId: m.vendors.mill.id, lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '200', ratePerKg: '280' }] });
    ok(receipt, 201);
    ok(await owner.post(`/api/v1/yarn-receipts/${receipt.body.data.id}/post`));
    const dc = (over: Record<string, unknown> = {}) => ({ docDate: '2026-10-03', vendorId: dyer.id, yarnProgramId: yp.id, lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '100' }], ...over });

    ok(await owner.post('/api/v1/outward-dcs', dc()), 409); // draft programme cannot be delivered under
    const stores = await asUser(['programs.view', 'programs.edit']);
    ok(await stores.post(`/api/v1/yarn-programs/${yp.id}/approve`), 403);
    const approved = await owner.post(`/api/v1/yarn-programs/${yp.id}/approve`);
    ok(approved);
    expect(approved.body.data.status).toBe('APPROVED');
    ok(await owner.post(`/api/v1/yarn-programs/${yp.id}/approve`), 409); // double approve
    ok(await owner.patch(`/api/v1/yarn-programs/${yp.id}`, { ...programBody(), version: approved.body.data.version }), 409); // locked

    // A fabric programme step for a yarn process is refused; so is a yarn not in the mix; and both / neither programme.
    const fabric = await createProgram(owner, m, order.id);
    ok(await owner.post('/api/v1/outward-dcs', dc({ lines: [{ itemId: m.items.lycra.id, qtyKg: '5' }] })), 400);
    ok(await owner.post('/api/v1/outward-dcs', dc({ programProcessId: fabric.processes[0]!.id })), 400);
    ok(await owner.post('/api/v1/outward-dcs', dc({ yarnProgramId: null })), 400);

    const out = await owner.post('/api/v1/outward-dcs', dc());
    ok(out, 201);
    expect(out.body.data).toMatchObject({ yarnProgramId: yp.id, programProcessId: null, processId: yarnDyeing.id, program: { programNo: yp.programNo, kind: 'YARN' } });
    await approveOutward(owner, out.body.data.id);
    const posted = await owner.post(`/api/v1/outward-dcs/${out.body.data.id}/post`);
    ok(posted);
    expect(posted.body.data.allowedLossPct).toBe('4');
    ok(await owner.post(`/api/v1/yarn-programs/${yp.id}/cancel`, { reason: 'Changed plan' }), 409); // deliveries exist

    const pending = await owner.get(`/api/v1/outward-dcs/pending?vendorId=${dyer.id}`);
    ok(pending);
    expect(pending.body.data).toEqual([expect.objectContaining({ id: out.body.data.id, outputKind: 'YARN', outputItemId: dyedYarn.id })]);

    // Inward: fabric refused; 97 kg dyed yarn back to the yarn store, no rolls.
    ok(await owner.post('/api/v1/inward-dcs', { docDate: '2026-10-10', vendorId: dyer.id, lines: [{ itemId: m.items.dyed.id, kg: '97' }], links: [{ outwardDcId: out.body.data.id, receivedKg: '97' }] }), 400);
    const dyeLot = uid('DL');
    const inw = await owner.post('/api/v1/inward-dcs', { docDate: '2026-10-10', vendorId: dyer.id, lines: [{ itemId: dyedYarn.id, kg: '97', lot: dyeLot, colour: 'NAVY' }], links: [{ outwardDcId: out.body.data.id, receivedKg: '97' }] });
    ok(inw, 201);
    const inPosted = await owner.post(`/api/v1/inward-dcs/${inw.body.data.id}/post`);
    ok(inPosted);
    expect(inPosted.body.data.lines[0].roll).toBeNull();
    expect(await kgAt(dyedYarn.id, dyeLot, 'YARN_STORE')).toBe('97.000');
    expect(await kgAt(m.items.yarn.id, lot, 'YARN_STORE')).toBe('100.000');
    ok(await owner.post(`/api/v1/outward-dcs/${out.body.data.id}/post`), 409); // double post

    const closed = await owner.post(`/api/v1/outward-dcs/${out.body.data.id}/close`, { reason: 'Job done' });
    ok(closed);
    expect(closed.body.data.loss).toMatchObject({ sentKg: '100.000', receivedKg: '97.000', lossPct: '3.0000', excessKg: '0.000', final: true });
    await assertLedgerInvariants();
  });

  it('cancelling a yarn inward reverses it; lists by process; a user without programs.view is refused', async () => {
    const yp = (await owner.post('/api/v1/yarn-programs', programBody({ allowedLossPct: '0' }))).body.data;
    ok(await owner.post(`/api/v1/yarn-programs/${yp.id}/approve`));
    const lot = uid('L');
    const receipt = await owner.post('/api/v1/yarn-receipts', { docDate: '2026-10-01', vendorId: m.vendors.mill.id, lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '20', ratePerKg: '280' }] });
    ok(await owner.post(`/api/v1/yarn-receipts/${receipt.body.data.id}/post`));
    const out = await owner.post('/api/v1/outward-dcs', { docDate: '2026-10-03', vendorId: dyer.id, yarnProgramId: yp.id, lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '20' }] });
    ok(out, 201);
    await approveOutward(owner, out.body.data.id);
    ok(await owner.post(`/api/v1/outward-dcs/${out.body.data.id}/post`));
    const dyeLot = uid('DL');
    const inw = await owner.post('/api/v1/inward-dcs', { docDate: '2026-10-10', vendorId: dyer.id, lines: [{ itemId: dyedYarn.id, kg: '20', lot: dyeLot }], links: [{ outwardDcId: out.body.data.id, receivedKg: '20' }] });
    ok(await owner.post(`/api/v1/inward-dcs/${inw.body.data.id}/post`));
    expect(await kgAt(dyedYarn.id, dyeLot, 'YARN_STORE')).toBe('20.000');
    ok(await owner.post(`/api/v1/inward-dcs/${inw.body.data.id}/cancel`, { reason: 'Wrong lot' }));
    expect(await kgAt(dyedYarn.id, dyeLot, 'YARN_STORE')).toBe('0.000');
    await assertLedgerInvariants();

    const list = await owner.get(`/api/v1/yarn-programs?processId=${yarnDyeing.id}&orderId=${order.id}`);
    ok(list);
    expect(list.body.data.every((r: { processId: string }) => r.processId === yarnDyeing.id)).toBe(true);
    ok(await (await asUser(['orders.view'])).get('/api/v1/yarn-programs'), 403);
  });
});
