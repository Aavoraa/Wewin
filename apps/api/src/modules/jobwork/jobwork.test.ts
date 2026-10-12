import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTx } from '../../core/db';
import { ledger } from '../../core/ledger/ledger.service';
import { type Client, asUser, assertLedgerInvariants, locationId, uid } from '../../../test/helpers';
import { type Masters, createOrder, createProgram, masters } from '../../../test/fixtures';

let owner: Client;
let m: Masters;
let order: { id: string; orderNo: string };
let program: { id: string; processes: { id: string; sequence: number }[] };
const pp = (seq: number) => program.processes.find((p) => p.sequence === seq)!.id;
let L: Record<'YARN_STORE' | 'FABRIC_STORE' | 'PROCESS_LOSS' | 'CONSUMED', string>;

async function bal(itemId: string, location: string, lot = '', colour = '') {
  const [b] = await withTx((tx) => ledger.balances(tx, [{ itemId, locationId: location, lot, colour, size: '' }]));
  return b!.qty;
}

async function postedYarn(lot: string, cottonKg: string, lycraKg = '0') {
  const lines = [{ itemId: m.items.yarn.id, lot, qtyKg: cottonKg, ratePerKg: '280' }];
  if (lycraKg !== '0') lines.push({ itemId: m.items.lycra.id, lot: `${lot}-LY`, qtyKg: lycraKg, ratePerKg: '640' });
  const r = await owner.post('/api/v1/yarn-receipts', { docDate: '2026-10-01', vendorId: m.vendors.mill.id, lines });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect((await owner.post(`/api/v1/yarn-receipts/${r.body.data.id}/post`)).status).toBe(200);
}

async function outward(body: Record<string, unknown>, post = true) {
  const r = await owner.post('/api/v1/outward-dcs', { docDate: '2026-10-02', ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  if (!post) return r.body.data;
  const p = await owner.post(`/api/v1/outward-dcs/${r.body.data.id}/post`);
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  return p.body.data;
}

async function inward(body: Record<string, unknown>, post = true) {
  const r = await owner.post('/api/v1/inward-dcs', { docDate: '2026-10-08', ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  if (!post) return r.body.data;
  const p = await owner.post(`/api/v1/inward-dcs/${r.body.data.id}/post`);
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  return p.body.data;
}

beforeAll(async () => {
  owner = await asUser('OWNER');
  m = await masters();
  order = await createOrder(owner, m);
  program = await createProgram(owner, m, order.id);
  L = {
    YARN_STORE: await locationId('YARN_STORE'),
    FABRIC_STORE: await locationId('FABRIC_STORE'),
    PROCESS_LOSS: await locationId('PROCESS_LOSS'),
    CONSUMED: await locationId('CONSUMED'),
  };
});

describe('fabric job work — knitting', () => {
  let out: { id: string; docNo: string };
  const lot = uid('KL');

  it('outward D.C. to the knitter: draft has no stock effect; post moves YARN_STORE → knitter and snapshots the loss limit', async () => {
    await postedYarn(lot, '1000', '50');
    const draft = await outward(
      {
        vendorId: m.vendors.knitter.id,
        programProcessId: pp(1),
        lines: [
          { itemId: m.items.yarn.id, lot, qtyKg: '950', valuePerKg: '280' },
          { itemId: m.items.lycra.id, lot: `${lot}-LY`, qtyKg: '50', valuePerKg: '640' },
        ],
      },
      false,
    );
    expect(draft.status).toBe('DRAFT');
    expect(await bal(m.items.yarn.id, m.vendors.knitter.locationId, lot)).toBe('0.000');
    const posted = await owner.post(`/api/v1/outward-dcs/${draft.id}/post`);
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    out = posted.body.data;
    expect(posted.body.data).toMatchObject({ status: 'POSTED', allowedLossPct: '2', totals: { sentKg: '1000.000', value: '298000.00' } });
    expect(posted.body.data.docNo).toMatch(/^YDC\/26-27\/\d{4}$/);
    expect(posted.body.data.expectedReturnDate).toBe('2026-10-17'); // doc date + KNITTING default 15 days
    expect(await bal(m.items.yarn.id, L.YARN_STORE, lot)).toBe('50.000');
    expect(await bal(m.items.yarn.id, m.vendors.knitter.locationId, lot)).toBe('950.000');
    expect(await bal(m.items.lycra.id, m.vendors.knitter.locationId, `${lot}-LY`)).toBe('50.000');
  });

  it('pending list shows what is still at the knitter', async () => {
    const res = await owner.get(`/api/v1/outward-dcs/pending?vendorId=${m.vendors.knitter.id}`);
    const row = res.body.data.find((r: { id: string }) => r.id === out.id);
    expect(row).toMatchObject({ sentKg: '1000.000', receivedKg: '0.000', pendingKg: '1000.000', outputItemId: m.items.greige.id });
  });

  it('inward with greige rolls consumes yarn proportionally (cotton + lycra) and shows a running loss', async () => {
    const inw = await inward({
      vendorId: m.vendors.knitter.id,
      vendorDcNo: 'SMK-881',
      lines: [
        { itemId: m.items.greige.id, kg: '320', lot: 'K1' },
        { itemId: m.items.greige.id, kg: '320', lot: 'K1' },
        { itemId: m.items.greige.id, kg: '320', lot: 'K1' },
      ],
      links: [{ outwardDcId: out.id, receivedKg: '960' }],
    });
    expect(inw.docNo).toMatch(/^INW\/26-27\/\d{4}$/);
    expect(inw.lines.map((l: { rollNo: string }) => l.rollNo)).toEqual([`${inw.docNo}/1`, `${inw.docNo}/2`, `${inw.docNo}/3`]);
    expect(await bal(m.items.greige.id, L.FABRIC_STORE, 'K1')).toBe('960.000');
    expect(await bal(m.items.yarn.id, m.vendors.knitter.locationId, lot)).toBe('38.000'); // 950 − 912
    expect(await bal(m.items.lycra.id, m.vendors.knitter.locationId, `${lot}-LY`)).toBe('2.000'); // 50 − 48
    const loss = (await owner.get(`/api/v1/outward-dcs/${out.id}/loss`)).body.data;
    expect(loss).toMatchObject({ sentKg: '1000.000', receivedKg: '960.000', lossPct: '4.0000', excessKg: '20.000', band: 'OVER', final: false, pendingKg: '40.000' });
  });

  it('refuses receiving more than is pending (QTY_EXCEEDS_PENDING)', async () => {
    const r = await owner.post('/api/v1/inward-dcs', {
      docDate: '2026-10-09',
      vendorId: m.vendors.knitter.id,
      lines: [{ itemId: m.items.greige.id, kg: '40.001', lot: 'K2' }],
      links: [{ outwardDcId: out.id, receivedKg: '40.001' }],
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('QTY_EXCEEDS_PENDING');
  });

  it('two concurrent inwards against the same pending kg: only one can post', async () => {
    const mk = () =>
      owner.post('/api/v1/inward-dcs', {
        docDate: '2026-10-09',
        vendorId: m.vendors.knitter.id,
        lines: [{ itemId: m.items.greige.id, kg: '25', lot: 'K2' }],
        links: [{ outwardDcId: out.id, receivedKg: '25' }],
      });
    const [a, b] = await Promise.all([mk(), mk()]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const res = await Promise.all([owner.post(`/api/v1/inward-dcs/${a.body.data.id}/post`), owner.post(`/api/v1/inward-dcs/${b.body.data.id}/post`)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = res.find((r) => r.status === 409)!;
    expect(loser.body.error.code).toBe('QTY_EXCEEDS_PENDING');
    const loss = (await owner.get(`/api/v1/outward-dcs/${out.id}/loss`)).body.data;
    expect(loss).toMatchObject({ receivedKg: '985.000', lossPct: '1.5000', excessKg: '0.000', band: 'OK' }); // 1.5 % < 80 % of 2 %
  });

  it('an outward with received inwards cannot be cancelled', async () => {
    const r = await owner.post(`/api/v1/outward-dcs/${out.id}/cancel`, { reason: 'test cancel' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DOC_HAS_DEPENDENTS');
  });

  it('close posts the residual to PROCESS_LOSS and freezes the final loss', async () => {
    const lossBefore = await bal(m.items.yarn.id, L.PROCESS_LOSS, lot);
    const r = await owner.post(`/api/v1/outward-dcs/${out.id}/close`, { reason: 'Knitting complete' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.status).toBe('CLOSED');
    expect(r.body.data.loss).toMatchObject({ final: true, sentKg: '1000.000', receivedKg: '985.000', lossKg: '15.000', lossPct: '1.5000', excessKg: '0.000' });
    expect(await bal(m.items.yarn.id, m.vendors.knitter.locationId, lot)).toBe('0.000');
    expect(await bal(m.items.lycra.id, m.vendors.knitter.locationId, `${lot}-LY`)).toBe('0.000');
    // residual: cotton 950 − 935.75 = 14.25, lycra 50 − 49.25 = 0.75 (proportional consumption)
    expect(Number(await bal(m.items.yarn.id, L.PROCESS_LOSS, lot)) - Number(lossBefore)).toBeCloseTo(14.25, 3);
    expect((await owner.post(`/api/v1/outward-dcs/${out.id}/close`, { reason: 'again' })).status).toBe(409);
    await assertLedgerInvariants();
  });

  it('inward linked to a closed outward cannot be cancelled', async () => {
    const link = await prisma.dcLink.findFirstOrThrow({ where: { outwardDcId: out.id, inward: { status: 'POSTED' } } });
    const r = await owner.post(`/api/v1/inward-dcs/${link.inwardDcId}/cancel`, { reason: 'test' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DOC_HAS_DEPENDENTS');
  });

  it('a program referenced by D.C.s cannot be cancelled', async () => {
    const r = await owner.post(`/api/v1/programs/${program.id}/cancel`, { reason: 'test' });
    expect(r.status).toBe(409);
  });
});

describe('excess loss on close', () => {
  it('freezes excess kg and notifies alert recipients once', async () => {
    const lot = uid('XL');
    await postedYarn(lot, '500');
    const out = await outward({ vendorId: m.vendors.knitter2.id, programProcessId: pp(1), lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '500' }] });
    await inward({
      vendorId: m.vendors.knitter2.id,
      lines: [{ itemId: m.items.greige.id, kg: '470', lot: 'K9' }],
      links: [{ outwardDcId: out.id, receivedKg: '470' }],
    });
    const closed = await owner.post(`/api/v1/outward-dcs/${out.id}/close`, { reason: 'Short return accepted' });
    expect(closed.body.data.loss).toMatchObject({ lossPct: '6.0000', excessKg: '20.000', band: 'OVER' });
    const notes = await prisma.notification.findMany({ where: { eventKey: `EXCESS_LOSS:${out.id}` }, include: { deliveries: true } });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((n) => n.userId === owner.userId)).toBe(true);
    const wa = notes[0]!.deliveries.find((d) => d.channel === 'WHATSAPP');
    expect(wa?.status).toBe('SKIPPED_NOT_CONFIGURED'); // never pretend WhatsApp delivered
    const mine = await owner.get('/api/v1/notifications?unread=true');
    expect(mine.body.data.some((n: { eventKey: string }) => n.eventKey === `EXCESS_LOSS:${out.id}`)).toBe(true);
  });
});

describe('fabric job work — dyeing with a direct transfer to the compactor', () => {
  it('greige rolls → dyer; dyed output held at the dyer; vendor → vendor to compactor; finished rolls into the store', async () => {
    const lot = uid('DL');
    await postedYarn(lot, '700');
    const knit = await outward({ vendorId: m.vendors.knitter.id, programProcessId: pp(1), lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '700' }] });
    const greige = await inward({
      vendorId: m.vendors.knitter.id,
      lines: [
        { itemId: m.items.greige.id, kg: '345', lot },
        { itemId: m.items.greige.id, kg: '340', lot },
      ],
      links: [{ outwardDcId: knit.id, receivedKg: '685' }],
    });
    const rolls = greige.lines.map((l: { roll: { id: string } }) => l.roll.id);
    // Send the two greige rolls (by roll) to the dyer.
    const dyeOut = await outward({
      vendorId: m.vendors.dyer.id,
      programProcessId: pp(2),
      lines: [
        { itemId: m.items.greige.id, rollId: rolls[0], qtyKg: '345' },
        { itemId: m.items.greige.id, rollId: rolls[1], qtyKg: '340' },
      ],
    });
    expect(dyeOut.lines[0].lot).toBe(lot); // lot taken from the roll
    expect(await bal(m.items.greige.id, m.vendors.dyer.locationId, lot)).toBe('685.000');
    // Dyed fabric stays at the dyer for a direct transfer.
    const dyed = await inward({
      vendorId: m.vendors.dyer.id,
      holdAtVendor: true,
      lines: [{ itemId: m.items.dyed.id, kg: '630', lot: 'DYE-77', colour: 'NAVY', gsm: 160, dia: '30' }],
      links: [{ outwardDcId: dyeOut.id, receivedKg: '630' }],
    });
    expect(dyed.holdAtVendor).toBe(true);
    expect(await bal(m.items.dyed.id, m.vendors.dyer.locationId, 'DYE-77', 'NAVY')).toBe('630.000');
    expect(await bal(m.items.greige.id, m.vendors.dyer.locationId, lot)).toBe('55.000');
    // Direct transfer dyer → compactor.
    const comp = await outward({
      vendorId: m.vendors.compactor.id,
      fromVendorId: m.vendors.dyer.id,
      programProcessId: pp(3),
      lines: [{ itemId: m.items.dyed.id, lot: 'DYE-77', colour: 'NAVY', qtyKg: '630' }],
    });
    expect(comp.fromLocation.kind).toBe('VENDOR');
    expect(await bal(m.items.dyed.id, m.vendors.dyer.locationId, 'DYE-77', 'NAVY')).toBe('0.000');
    expect(await bal(m.items.dyed.id, m.vendors.compactor.locationId, 'DYE-77', 'NAVY')).toBe('630.000');
    await inward({
      vendorId: m.vendors.compactor.id,
      lines: [
        { itemId: m.items.dyed.id, kg: '312.5', lot: 'DYE-77', colour: 'NAVY' },
        { itemId: m.items.dyed.id, kg: '311', lot: 'DYE-77', colour: 'NAVY' },
      ],
      links: [{ outwardDcId: comp.id, receivedKg: '623.5' }],
    });
    expect(await bal(m.items.dyed.id, L.FABRIC_STORE, 'DYE-77', 'NAVY')).toBe('623.500');
    const loss = (await owner.get(`/api/v1/outward-dcs/${comp.id}/loss`)).body.data;
    expect(loss).toMatchObject({ lossPct: '1.0317', excessKg: '0.200', band: 'OVER' }); // 6.5 kg vs 1 % (6.3 kg)
    await assertLedgerInvariants();
  });
});

describe('job work validation', () => {
  it('rejects a vendor not set up for the process, wrong outputs, other vendors’ D.C.s and unapproved programs', async () => {
    const lot = uid('VL');
    await postedYarn(lot, '100');
    // Dyer is not a knitter.
    const bad = await owner.post('/api/v1/outward-dcs', {
      docDate: '2026-10-02',
      vendorId: m.vendors.dyer.id,
      programProcessId: pp(1),
      lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '10' }],
    });
    expect(bad.status).toBe(400);
    const out = await outward({ vendorId: m.vendors.knitter.id, programProcessId: pp(1), lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '100' }] });
    // Output item must be the program's output (greige), not dyed fabric.
    const wrongItem = await owner.post('/api/v1/inward-dcs', {
      docDate: '2026-10-08',
      vendorId: m.vendors.knitter.id,
      lines: [{ itemId: m.items.dyed.id, kg: '10' }],
      links: [{ outwardDcId: out.id, receivedKg: '10' }],
    });
    expect(wrongItem.status).toBe(400);
    // Another vendor cannot return this D.C.
    const otherVendor = await owner.post('/api/v1/inward-dcs', {
      docDate: '2026-10-08',
      vendorId: m.vendors.knitter2.id,
      lines: [{ itemId: m.items.greige.id, kg: '10' }],
      links: [{ outwardDcId: out.id, receivedKg: '10' }],
    });
    expect(otherVendor.status).toBe(400);
    // Rolls must equal linked kg.
    const mismatch = await owner.post('/api/v1/inward-dcs', {
      docDate: '2026-10-08',
      vendorId: m.vendors.knitter.id,
      lines: [{ itemId: m.items.greige.id, kg: '10' }],
      links: [{ outwardDcId: out.id, receivedKg: '9' }],
    });
    expect(mismatch.status).toBe(400);
    // Unapproved program.
    const o2 = await createOrder(owner, m);
    const draftProg = await createProgram(owner, m, o2.id, { approve: false });
    const unapproved = await owner.post('/api/v1/outward-dcs', {
      docDate: '2026-10-02',
      vendorId: m.vendors.knitter.id,
      programProcessId: draftProg.processes[0]!.id,
      lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '1' }],
    });
    expect(unapproved.status).toBe(409);
  });

  it('cannot send more than the store holds (NEGATIVE_STOCK) and leaves no trace', async () => {
    const lot = uid('NS');
    await postedYarn(lot, '10');
    const draft = await outward({ vendorId: m.vendors.knitter.id, programProcessId: pp(1), lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '10.5' }] }, false);
    const r = await owner.post(`/api/v1/outward-dcs/${draft.id}/post`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NEGATIVE_STOCK');
    expect((await prisma.outwardDc.findUnique({ where: { id: draft.id } }))?.status).toBe('DRAFT');
  });

  it('cancelling an inward (not billed, outward open) restores pending and reverses rolls and consumption', async () => {
    const lot = uid('CI');
    await postedYarn(lot, '200');
    const out = await outward({ vendorId: m.vendors.knitter.id, programProcessId: pp(1), lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '200' }] });
    const inw = await inward({ vendorId: m.vendors.knitter.id, lines: [{ itemId: m.items.greige.id, kg: '190', lot }], links: [{ outwardDcId: out.id, receivedKg: '190' }] });
    expect(await bal(m.items.yarn.id, m.vendors.knitter.locationId, lot)).toBe('10.000');
    const c = await owner.post(`/api/v1/inward-dcs/${inw.id}/cancel`, { reason: 'Wrong weights' });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(await bal(m.items.yarn.id, m.vendors.knitter.locationId, lot)).toBe('200.000');
    expect(await bal(m.items.greige.id, L.FABRIC_STORE, lot)).toBe('0.000');
    expect((await owner.get(`/api/v1/outward-dcs/${out.id}/loss`)).body.data.pendingKg).toBe('200.000');
    // The outward can now be cancelled too (no posted inward).
    expect((await owner.post(`/api/v1/outward-dcs/${out.id}/cancel`, { reason: 'Return to store' })).status).toBe(200);
    expect(await bal(m.items.yarn.id, L.YARN_STORE, lot)).toBe('200.000');
    await assertLedgerInvariants();
  });

  it('roll lookup for scanners', async () => {
    const roll = await prisma.fabricRoll.findFirstOrThrow();
    const r = await owner.get(`/api/v1/rolls/${encodeURIComponent(roll.rollNo)}`);
    expect(r.status).toBe(200);
    expect(r.body.data.rollNo).toBe(roll.rollNo);
  });

  it('enforces job-work permissions', async () => {
    const viewer = await asUser(['jobwork.view']);
    expect((await viewer.get('/api/v1/outward-dcs')).status).toBe(200);
    expect((await viewer.post('/api/v1/outward-dcs', {})).status).toBe(403);
    const sk = await asUser(['jobwork.view', 'jobwork.post']);
    const anyPosted = await prisma.outwardDc.findFirstOrThrow({ where: { status: 'POSTED' } });
    expect((await sk.post(`/api/v1/outward-dcs/${anyPosted.id}/close`, { reason: 'no perm' })).status).toBe(403);
  });
});
