import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { type ProgrammeScan, emptyProgrammeScan } from '@wewin/shared';
import { prisma } from '../../core/db';
import { type Client, app, asUser, uid } from '../../../test/helpers';
import { type Masters, createOrder, masters } from '../../../test/fixtures';
import { programmeScreenPdf as programmePdf } from '../../../test/invoice-fixtures';
import { scansService } from './scans.service';

let owner: Client;
let merch: Client;
let m: Masters;
let order: { id: string; orderNo: string };
const TAG = uid('').replace(/[^A-Z0-9]/g, '').slice(-5);
const STYLE = `${TAG} 67048,9 F/1 111 12847 PA`;
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);

async function upload(c: Client, buf: Buffer) {
  const res = await request(app).post('/api/v1/invoice-scans').set('authorization', `Bearer ${c.token}`).attach('file', buf, { filename: 'programme-entry.pdf', contentType: 'application/pdf' });
  ok(res, 201);
  const id = res.body.data.id as string;
  // Workers are off in tests: the job runs inline after the upload; run it here too (a second run is a no-op) and wait.
  await scansService.process(id);
  for (let i = 0; i < 600; i++) {
    const s = await prisma.invoiceScan.findUniqueOrThrow({ where: { id } });
    if (!['QUEUED', 'PROCESSING'].includes(s.status)) return (await c.get(`/api/v1/invoice-scans/${id}`)).body.data;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('extraction did not finish');
}

/** What AI extraction returns for the screenshot the user shared (NECK RIB selected). */
const fullRead = (orderRef: string): ProgrammeScan => ({
  ...emptyProgrammeScan(),
  orderRef,
  colour: 'navy',
  orderQty: '1600',
  portions: [
    { portion: 'BODY + SLV', fabColour: 'NAVY', printColour: '', selected: false },
    { portion: 'NECK RIB', fabColour: 'NAVY', printColour: '', selected: true },
    { portion: 'FOLDING', fabColour: 'NAVY', printColour: '', selected: false },
  ],
  fabricDescription: `1*1 LYC RIB ${TAG}`,
  fabricType: 'Knits',
  greyGsm: '260',
  finalGsm: '260',
  gauge: '0',
  loopLength: '0',
  uom: 'Kgs',
  mtrToKg: '0',
  collarCuffReqd: '0',
  withMeasurement: false,
  measureUnit: 'CM',
  tubSingle: '0',
  processTemplate: 'GREY PUR + DYEING (KGS)',
  yarns: [
    { counts: `30s 100% COMBED ${TAG}`, colour: '', consPct: '96.00' },
    { counts: 'LYCRA', colour: '', consPct: '4.00' },
  ],
  processes: [
    { name: 'GREY FABRIC PURCHASE (', lossPct: '0' }, // cut off on the desktop screen
    { name: 'DYEING', lossPct: '5' },
    { name: 'COMPACTING', lossPct: '0' },
  ],
  sizes: ['2Y', '4Y'].map((size) => ({ size, length: '0', lengthAllowance: '0', width: '0', widthAllowance: '0', pcsWeight: '0', actDia: '0', actPcsWeight: '6', knitDia: '32', finishDia: '33' })),
});

beforeAll(async () => {
  owner = await asUser('OWNER');
  merch = await asUser(['scans.view', 'scans.upload', 'scans.apply', 'orders.view', 'programs.view', 'programs.edit', 'masters.view']);
  m = await masters();
  order = await createOrder(owner, m);
  await prisma.order.update({ where: { id: order.id }, data: { styleNo: STYLE } });
  // An earlier programme with the same fabric description and yarn counts: the scan "remembers" its items.
  ok(
    await owner.post('/api/v1/programs', {
      orderId: order.id,
      fabricItemId: m.items.dyed.id,
      colour: 'NAVY',
      requiredKg: '10',
      fabricDescription: `1*1 LYC RIB ${TAG}`,
      yarnMix: [{ yarnItemId: m.items.yarn.id, counts: `30s 100% COMBED ${TAG}`, consPct: '100' }],
      processes: [{ sequence: 1, processId: m.processes.dyeing.id, inputItemId: m.items.greige.id, outputItemId: m.items.dyed.id, allowedLossPct: '5' }],
    }),
    201,
  );
});

describe('Programme Entry screenshot → fabric programme (Q-068)', () => {
  it('is recognised as a programme screen (not an invoice), the order is suggested from the desktop order ref and must be confirmed', async () => {
    const ref = `O/0001/WKF/25/${STYLE}`;
    let d = await upload(merch, await programmePdf(ref));
    expect(d.extraction.classification.class).toBe('PROGRAMME_SCREEN');
    expect(d.review.target).toBe('PROGRAM');
    expect(d.review.lines).toEqual([]);
    expect(d.review.programmeOrder).toMatchObject({ state: 'SUGGESTED', id: order.id });
    expect(d.status).toBe('NEEDS_REVIEW');
    expect(d.validation.issues.map((i: { code: string }) => i.code)).toContain('ORDER_NOT_CONFIRMED');
    ok(await merch.post(`/api/v1/invoice-scans/${d.id}/apply`, { version: d.version }), 400);

    // Stand in for AI extraction: the full reading of the user's screenshot.
    const programme = fullRead(ref);
    const row = await prisma.invoiceScan.findUniqueOrThrow({ where: { id: d.id } });
    await prisma.invoiceScan.update({
      where: { id: d.id },
      data: { extraction: { ...(row.extraction as object), programme }, review: { ...(row.review as object), programme } },
    });
    d = (await merch.patch(`/api/v1/invoice-scans/${d.id}/review`, { version: d.version, programmeOrderId: order.id })).body.data;
    expect(d.status, JSON.stringify(d.validation)).toBe('READY');

    const draft = (await merch.get(`/api/v1/invoice-scans/${d.id}/programme-draft`)).body.data;
    const grey = await prisma.process.findUniqueOrThrow({ where: { code: 'GREY_PURCHASE' } });
    expect(draft).toMatchObject({
      sourceScanId: d.id,
      orderId: order.id,
      colour: 'NAVY', // matched to the order's colour
      portion: 'NECK RIB',
      fabricItemId: m.items.dyed.id, // remembered from the earlier programme
      fabricDescription: `1*1 LYC RIB ${TAG}`,
      fabricType: 'Knits',
      greyGsm: 260,
      gsm: 260,
      gauge: null, // the desktop shows 0 for blanks
      uom: 'Kgs',
      processTemplate: 'GREY PUR + DYEING (KGS)',
    });
    expect(draft.yarnMix).toEqual([
      { yarnItemId: m.items.yarn.id, counts: `30s 100% COMBED ${TAG}`, colour: null, consPct: '96' },
      { yarnItemId: expect.toBeOneOf([null, expect.any(String)]), counts: 'LYCRA', colour: null, consPct: '4' }, // remembered when an earlier programme used LYCRA
    ]);
    expect(draft.processes.map((p: { processId: string; allowedLossPct: string }) => [p.processId, p.allowedLossPct])).toEqual([
      [grey.id, '0'],
      [m.processes.dyeing.id, '5'],
      [m.processes.compacting.id, '0'],
    ]);
    expect(draft.sizeSpecs[0]).toEqual({ size: '2Y', length: null, lengthAllowance: null, width: null, widthAllowance: null, pcsWeight: null, actDia: null, actPcsWeight: '6', knitDia: '32', finishDia: '33' });
    expect(draft.otherPortions).toEqual([
      { portion: 'BODY + SLV', colour: 'NAVY', printColour: '' },
      { portion: 'FOLDING', colour: 'NAVY', printColour: '' },
    ]);

    // The user completes the route's items on the form and saves: the scan is marked used, once.
    const { orderLabel: _l, orderRef: _r, colourRead: _c, otherPortions: _o, labels: _b, ...payload } = draft;
    const body = {
      ...payload,
      requiredKg: '9.6',
      yarnMix: payload.yarnMix.map((y: { yarnItemId: string | null }) => ({ ...y, yarnItemId: y.yarnItemId ?? m.items.lycra.id })),
      processes: [
        { sequence: 1, processId: grey.id, inputItemId: m.items.greige.id, outputItemId: m.items.greige.id, allowedLossPct: '0' },
        { sequence: 2, processId: m.processes.dyeing.id, inputItemId: m.items.greige.id, outputItemId: m.items.dyed.id, allowedLossPct: '5' },
      ],
    };
    const created = await merch.post('/api/v1/programs', body);
    ok(created, 201);
    expect(created.body.data).toMatchObject({ portion: 'NECK RIB', sourceScanId: d.id });
    const after = (await merch.get(`/api/v1/invoice-scans/${d.id}`)).body.data;
    expect(after).toMatchObject({ status: 'APPLIED', applied: { docType: 'PROGRAM', id: created.body.data.id, route: `/programs/${created.body.data.id}` } });
    ok(await merch.post('/api/v1/programs', body), 409);
    ok(await merch.get(`/api/v1/invoice-scans/${d.id}/programme-draft`), 409);
  });

  it('needs programs.edit for the programme draft', async () => {
    const d = await upload(merch, await programmePdf(`O/0002/WKF/25/${STYLE}`));
    const noProg = await asUser(['scans.view', 'scans.apply']);
    ok(await noProg.get(`/api/v1/invoice-scans/${d.id}/programme-draft`), 403);
  });
});

describe('uploaded from the order\'s Fabric programs tab (Q-068)', () => {
  it('belongs to that order straight away (no order to confirm) and is listed on the order with what was read', async () => {
    const res = await request(app)
      .post('/api/v1/invoice-scans')
      .set('authorization', `Bearer ${merch.token}`)
      .field('target', 'PROGRAM')
      .field('orderId', order.id)
      .attach('file', await programmePdf('O/0009/WKF/25/NO-MATCH-REF'), { filename: 'neck-rib.pdf', contentType: 'application/pdf' });
    ok(res, 201);
    const id = res.body.data.id as string;
    await scansService.process(id);
    for (let i = 0; i < 600 && ['QUEUED', 'PROCESSING'].includes((await prisma.invoiceScan.findUniqueOrThrow({ where: { id } })).status); i++) await new Promise((r) => setTimeout(r, 100));
    const d = (await merch.get(`/api/v1/invoice-scans/${id}`)).body.data;
    expect(d.review.programmeOrder).toMatchObject({ id: order.id, state: 'CONFIRMED' });
    expect(d.status).toBe('READY');
    const list = await merch.get(`/api/v1/orders/${order.id}/programme-scans`);
    ok(list);
    expect(list.body.data.find((x: { id: string }) => x.id === id)).toMatchObject({ originalName: 'neck-rib.pdf', status: 'READY', programme: expect.objectContaining({ colour: 'NAVY' }), program: null });
    // An invoice cannot be uploaded against an order.
    const bad = await request(app).post('/api/v1/invoice-scans').set('authorization', `Bearer ${merch.token}`).field('orderId', order.id).attach('file', await programmePdf('X'), { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(bad.status).toBe(400);
  });
});

describe('"Save programme": every portion saved as a draft at once (Q-070)', () => {
  it('saves NECK RIB with what was read and BODY + SLV / FOLDING as drafts; approval needs the missing parts', async () => {
    const res = await request(app).post('/api/v1/invoice-scans').set('authorization', `Bearer ${merch.token}`).field('target', 'PROGRAM').field('orderId', order.id).attach('file', await programmePdf('O/0010/WKF/25/SAVE'), { filename: 'save.pdf', contentType: 'application/pdf' });
    ok(res, 201);
    const id = res.body.data.id as string;
    await scansService.process(id);
    for (let i = 0; i < 600 && ['QUEUED', 'PROCESSING'].includes((await prisma.invoiceScan.findUniqueOrThrow({ where: { id } })).status); i++) await new Promise((r) => setTimeout(r, 100));
    // Stand in for AI: the full reading of the user's screenshot, sizes as on this order.
    const read = { ...fullRead('O/0010/WKF/25/SAVE'), fabricDescription: `NEW FABRIC ${TAG}`, sizes: fullRead('x').sizes };
    const row = await prisma.invoiceScan.findUniqueOrThrow({ where: { id } });
    await prisma.invoiceScan.update({ where: { id }, data: { review: { ...(row.review as object), programme: read } } });

    const saved = await merch.post(`/api/v1/invoice-scans/${id}/save-programmes`);
    ok(saved, 201);
    const progs = saved.body.data.programs as { id: string; portion: string; missing: string[] }[];
    expect(progs.map((p) => p.portion)).toEqual(['NECK RIB', 'BODY + SLV', 'FOLDING']);
    expect(progs[0]!.missing).toEqual(expect.arrayContaining(['finished fabric item', 'input item of process 1']));
    const neck = (await merch.get(`/api/v1/programs/${progs[0]!.id}`)).body.data;
    expect(neck).toMatchObject({ status: 'DRAFT', portion: 'NECK RIB', fabricItemId: null, fabricDescription: `NEW FABRIC ${TAG}`, greyGsm: 260, processTemplate: 'GREY PUR + DYEING (KGS)', sourceScanId: id });
    expect(neck.requiredKg).toMatch(/^\d+\.\d{3}$/); // pieces of NAVY × 6 g
    expect(neck.processes).toHaveLength(3);
    expect(neck.yarnMix.map((y: { counts: string }) => y.counts)).toEqual([`30s 100% COMBED ${TAG}`, 'LYCRA']);
    expect((await merch.get(`/api/v1/invoice-scans/${id}`)).body.data.status).toBe('APPLIED');
    ok(await merch.post(`/api/v1/invoice-scans/${id}/save-programmes`), 409); // once

    // Approval needs everything; the draft is completed later.
    const refused = await owner.post(`/api/v1/programs/${progs[0]!.id}/approve`);
    ok(refused, 400);
    expect(refused.body.error.message).toMatch(/finished fabric item/);
    const complete = await owner.patch(`/api/v1/programs/${neck.id}`, {
      ...neck,
      orderId: undefined,
      version: neck.version,
      fabricItemId: m.items.dyed.id,
      processes: neck.processes.map((p: { sequence: number; processId: string; allowedLossPct: string }) => ({ sequence: p.sequence, processId: p.processId, allowedLossPct: p.allowedLossPct, inputItemId: m.items.greige.id, outputItemId: m.items.dyed.id })),
    });
    ok(complete);
    ok(await owner.post(`/api/v1/programs/${neck.id}/approve`));
    // The incomplete portions are listed with the order.
    const o = (await owner.get(`/api/v1/orders/${order.id}`)).body.data;
    expect(o.programs.some((p: { id: string; fabricItem: unknown }) => p.id === progs[1]!.id && p.fabricItem === null)).toBe(true);
  });
});

describe('deleting an uploaded file', () => {
  it('removes the file and what was read (history kept); refused once a document was created from it', async () => {
    const res = await request(app).post('/api/v1/invoice-scans').set('authorization', `Bearer ${merch.token}`).field('target', 'PROGRAM').field('orderId', order.id).attach('file', await programmePdf('O/0011/DEL'), { filename: 'to-delete.pdf', contentType: 'application/pdf' });
    ok(res, 201);
    const id = res.body.data.id as string;
    await scansService.process(id);
    for (let i = 0; i < 600 && ['QUEUED', 'PROCESSING'].includes((await prisma.invoiceScan.findUniqueOrThrow({ where: { id } })).status); i++) await new Promise((r) => setTimeout(r, 100));
    ok(await merch.del(`/api/v1/invoice-scans/${id}`), 204);
    const row = await prisma.invoiceScan.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'DISCARDED', review: null, extraction: null });
    expect(row.purgedAt).not.toBeNull();
    expect((await prisma.invoiceScanEvent.findMany({ where: { scanId: id, kind: 'DELETED' } })).length).toBe(1);
    expect((await merch.get(`/api/v1/orders/${order.id}/programme-scans`)).body.data.some((x: { id: string }) => x.id === id)).toBe(false);
    ok(await merch.get(`/api/v1/invoice-scans/${id}/file`), 404);

    const used = await prisma.invoiceScan.findFirstOrThrow({ where: { status: 'APPLIED', target: 'PROGRAM' } });
    ok(await owner.del(`/api/v1/invoice-scans/${used.id}`), 409);
  });
});
