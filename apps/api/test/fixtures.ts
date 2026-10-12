import { expect } from 'vitest';
import { prisma } from '../src/core/db';
import { type Client, uid } from './helpers';

/** Master data for document tests (created directly; masters have their own API tests). */
export async function masters() {
  const mk = (type: 'YARN' | 'FABRIC' | 'PANEL' | 'GARMENT' | 'TRIM', unit: 'KG' | 'PCS' | 'NOS', name: string) =>
    prisma.item.create({ data: { code: uid(type.slice(0, 3)), name, type, unit } });
  const proc = async (code: string, stage: 'KG' | 'PCS') =>
    prisma.process.upsert({ where: { code }, create: { code, name: code, stage, defaultReturnDays: 15 }, update: {} });
  const vendor = async (name: string, processId?: string) => {
    const v = await prisma.vendor.create({ data: { code: uid('V'), name, creditDays: 30 } });
    const loc = await prisma.location.create({ data: { code: `V-${v.code}`, name, kind: 'VENDOR', vendorId: v.id } });
    if (processId) await prisma.vendorProcess.create({ data: { vendorId: v.id, processId } });
    return { ...v, locationId: loc.id };
  };
  const [knitting, dyeing, compacting, printing, embroidery] = await Promise.all([
    proc('KNITTING', 'KG'),
    proc('DYEING', 'KG'),
    proc('COMPACTING', 'KG'),
    proc('PRINTING', 'PCS'),
    proc('EMBROIDERY', 'PCS'),
  ]);
  const buyer = await prisma.buyer.create({ data: { code: uid('BY'), name: 'Test Buyer', currency: 'USD' } });
  return {
    buyer,
    processes: { knitting, dyeing, compacting, printing, embroidery },
    items: {
      yarn: await mk('YARN', 'KG', '30s Combed'),
      lycra: await mk('YARN', 'KG', '20D Lycra'),
      greige: await mk('FABRIC', 'KG', 'Greige SJ'),
      dyed: await mk('FABRIC', 'KG', 'Dyed SJ'),
      front: await mk('PANEL', 'PCS', 'Front'),
      back: await mk('PANEL', 'PCS', 'Back'),
      sleeve: await mk('PANEL', 'PCS', 'Sleeve'),
      garment: await mk('GARMENT', 'PCS', 'Kids Tee'),
      label: await mk('TRIM', 'NOS', 'Main label'),
      polybag: await mk('TRIM', 'NOS', 'Polybag'),
    },
    vendors: {
      mill: await vendor('Test Mill'),
      knitter: await vendor('Test Knitter', knitting.id),
      knitter2: await vendor('Test Knitter 2', knitting.id),
      dyer: await vendor('Test Dyer', dyeing.id),
      compactor: await vendor('Test Compactor', compacting.id),
      printer: await vendor('Test Printer', printing.id),
      embroiderer: await vendor('Test Embroiderer', embroidery.id),
    },
  };
}
export type Masters = Awaited<ReturnType<typeof masters>>;

/** 3 colours × 5 sizes, 100 pcs each (1,500 pcs), price 3.25. */
export function orderBody(m: Masters, over: Record<string, unknown> = {}) {
  const colours = ['NAVY', 'RED', 'WHITE'];
  const sizes = ['2Y', '4Y', '6Y', '8Y', '10Y'];
  return {
    orderNo: uid('WW'),
    buyerId: m.buyer.id,
    buyerPoNo: uid('PO'),
    poDate: '2026-10-01',
    shipDate: '2026-12-15',
    styleNo: 'KT-101',
    styleName: 'Kids crew-neck tee',
    garmentItemId: m.items.garment.id,
    currency: 'USD',
    colours,
    sizes,
    lines: colours.flatMap((colour) => sizes.map((size) => ({ colour, size, qty: 100, unitPrice: '3.25' }))),
    components: [
      { code: 'FRONT', name: 'Front', panelItemId: m.items.front.id, pcsPerGarment: 1 },
      { code: 'BACK', name: 'Back', panelItemId: m.items.back.id, pcsPerGarment: 1 },
      { code: 'SLEEVE', name: 'Sleeve', panelItemId: m.items.sleeve.id, pcsPerGarment: 2 },
    ],
    ...over,
  };
}

export async function createOrder(c: Client, m: Masters, opts: { confirm?: boolean; panelCost?: string } = {}) {
  const res = await c.post('/api/v1/orders', orderBody(m));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = res.body.data;
  if (opts.panelCost) {
    const cs = await c.put(`/api/v1/orders/${order.id}/costing`, { panelCostPerPiece: opts.panelCost, lines: [] });
    expect(cs.status, JSON.stringify(cs.body)).toBe(200);
  }
  if (opts.confirm !== false) expect((await c.post(`/api/v1/orders/${order.id}/confirm`)).status).toBe(200);
  return order as { id: string; orderNo: string; version: number };
}

/** Knitting (2 %) → dyeing (8 %) → compacting (1 %) program, approved. */
export async function createProgram(c: Client, m: Masters, orderId: string, opts: { approve?: boolean; costs?: boolean } = {}) {
  const res = await c.post('/api/v1/programs', {
    orderId,
    fabricItemId: m.items.dyed.id,
    colour: 'NAVY',
    requiredKg: '500',
    gsm: 160,
    dia: '30 OW',
    processes: [
      { sequence: 1, processId: m.processes.knitting.id, inputItemId: m.items.yarn.id, outputItemId: m.items.greige.id, allowedLossPct: '2', materialCostPerKg: opts.costs === false ? null : '280' },
      { sequence: 2, processId: m.processes.dyeing.id, inputItemId: m.items.greige.id, outputItemId: m.items.dyed.id, allowedLossPct: '8', materialCostPerKg: opts.costs === false ? null : '310' },
      { sequence: 3, processId: m.processes.compacting.id, inputItemId: m.items.dyed.id, outputItemId: m.items.dyed.id, allowedLossPct: '1', materialCostPerKg: opts.costs === false ? null : '420' },
    ],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  if (opts.approve !== false) expect((await c.post(`/api/v1/programs/${res.body.data.id}/approve`)).status).toBe(200);
  const prog = (await c.get(`/api/v1/programs/${res.body.data.id}`)).body.data;
  return prog as { id: string; programNo: string; processes: { id: string; sequence: number }[] };
}

/**
 * Real dyed fabric rolls in FABRIC_STORE for an order, produced through the API:
 * yarn receipt → knitting outward/inward → dyeing outward (greige roll) / inward (dyed rolls).
 */
export async function dyedRolls(
  c: Client,
  m: Masters,
  program: { processes: { id: string; sequence: number }[] },
  colour: string,
  kgs: string[],
): Promise<{ id: string; rollNo: string; kg: string }[]> {
  const D = (await import('@wewin/shared')).D;
  const total = kgs.reduce((a, k) => a.plus(D(k)), D(0));
  const pp = (seq: number) => program.processes.find((p) => p.sequence === seq)!.id;
  const lot = uid('Y');
  const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);
  const yarn = await c.post('/api/v1/yarn-receipts', { docDate: '2026-10-01', vendorId: m.vendors.mill.id, lines: [{ itemId: m.items.yarn.id, lot, qtyKg: total.times(1.2).toFixed(3), ratePerKg: '280' }] });
  ok(yarn, 201);
  ok(await c.post(`/api/v1/yarn-receipts/${yarn.body.data.id}/post`));
  const ko = await c.post('/api/v1/outward-dcs', { docDate: '2026-10-02', vendorId: m.vendors.knitter.id, programProcessId: pp(1), lines: [{ itemId: m.items.yarn.id, lot, qtyKg: total.times(1.15).toFixed(3) }] });
  ok(ko, 201);
  ok(await c.post(`/api/v1/outward-dcs/${ko.body.data.id}/post`));
  const greigeKg = total.times(1.1).toFixed(3);
  const ki = await c.post('/api/v1/inward-dcs', { docDate: '2026-10-05', vendorId: m.vendors.knitter.id, lines: [{ itemId: m.items.greige.id, kg: greigeKg, lot }], links: [{ outwardDcId: ko.body.data.id, receivedKg: greigeKg }] });
  ok(ki, 201);
  const kiPosted = await c.post(`/api/v1/inward-dcs/${ki.body.data.id}/post`);
  ok(kiPosted);
  const greigeRoll = kiPosted.body.data.lines[0].roll.id;
  const dout = await c.post('/api/v1/outward-dcs', { docDate: '2026-10-06', vendorId: m.vendors.dyer.id, programProcessId: pp(2), lines: [{ itemId: m.items.greige.id, rollId: greigeRoll, qtyKg: greigeKg }] });
  ok(dout, 201);
  ok(await c.post(`/api/v1/outward-dcs/${dout.body.data.id}/post`));
  const dyeLot = uid('DL');
  const din = await c.post('/api/v1/inward-dcs', {
    docDate: '2026-10-08',
    vendorId: m.vendors.dyer.id,
    lines: kgs.map((kg) => ({ itemId: m.items.dyed.id, kg, lot: dyeLot, colour })),
    links: [{ outwardDcId: dout.body.data.id, receivedKg: total.toFixed(3) }],
  });
  ok(din, 201);
  const dinPosted = await c.post(`/api/v1/inward-dcs/${din.body.data.id}/post`);
  ok(dinPosted);
  return dinPosted.body.data.lines.map((l: { roll: { id: string; rollNo: string }; kg: string }) => ({ id: l.roll.id, rollNo: l.roll.rollNo, kg: l.kg }));
}
