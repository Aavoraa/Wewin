import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../core/db';
import { type Client, asUser } from '../../../test/helpers';
import { type Masters, createOrder, masters } from '../../../test/fixtures';

let owner: Client;
let m: Masters;
let order: { id: string; orderNo: string };
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);

beforeAll(async () => {
  owner = await asUser('OWNER');
  m = await masters();
  order = await createOrder(owner, m);
});

/** The desktop Programme Entry screen: order ref, colour, portion NECK RIB, 1*1 LYC RIB. */
const neckRib = () => ({
  orderId: order.id,
  fabricItemId: m.items.dyed.id,
  colour: 'NAVY',
  requiredKg: '120',
  gsm: 260,
  dia: '33',
  portion: 'NECK RIB',
  printColour: null,
  fabricDescription: '1*1 LYC RIB',
  fabricType: 'Knits',
  greyGsm: 260,
  gauge: '18',
  loopLength: '2.9',
  uom: 'Kgs',
  mtrToKg: '0',
  collarCuffReqd: 0,
  withMeasurement: false,
  measureUnit: 'CM',
  tubSingle: '0',
  processTemplate: 'GREY PUR + DYEING (KGS)',
  yarnMix: [
    { yarnItemId: m.items.yarn.id, counts: '30s 100% COMBED', consPct: '96' },
    { yarnItemId: m.items.lycra.id, counts: 'LYCRA', consPct: '4' },
  ],
  sizeSpecs: ['2Y', '4Y'].map((size) => ({ size, actPcsWeight: '6', knitDia: '32', finishDia: '33' })),
  processes: [
    { sequence: 1, processId: m.processes.knitting.id, inputItemId: m.items.yarn.id, outputItemId: m.items.greige.id, allowedLossPct: '0' },
    { sequence: 2, processId: m.processes.dyeing.id, inputItemId: m.items.greige.id, outputItemId: m.items.dyed.id, allowedLossPct: '5' },
  ],
});

describe('programme entry fields (Q-067)', () => {
  it('saves and returns the portion, fabric details, yarn mix and size-wise measurements; edits them', async () => {
    const created = await owner.post('/api/v1/programs', neckRib());
    ok(created, 201);
    const p = created.body.data;
    expect(p).toMatchObject({ portion: 'NECK RIB', fabricDescription: '1*1 LYC RIB', fabricType: 'Knits', greyGsm: 260, gauge: '18', loopLength: '2.9', uom: 'Kgs', processTemplate: 'GREY PUR + DYEING (KGS)' });
    expect(p.yarnMix).toEqual([
      { yarnItemId: m.items.yarn.id, counts: '30s 100% COMBED', colour: null, consPct: '96.0000' },
      { yarnItemId: m.items.lycra.id, counts: 'LYCRA', colour: null, consPct: '4.0000' },
    ]);
    expect(p.sizeSpecs[0]).toMatchObject({ size: '2Y', actPcsWeight: '6.000', knitDia: '32.000', finishDia: '33.000', length: null });

    const edited = await owner.patch(`/api/v1/programs/${p.id}`, { ...neckRib(), orderId: undefined, portion: 'BODY + SLV', withMeasurement: true, version: p.version });
    ok(edited);
    expect(edited.body.data).toMatchObject({ portion: 'BODY + SLV', withMeasurement: true });
  });

  it('refuses a yarn mix that does not add up to 100%', async () => {
    ok(await owner.post('/api/v1/programs', { ...neckRib(), yarnMix: [{ counts: '30s', consPct: '90' }] }), 400);
  });
});

describe('accessories requirement entry (Q-069)', () => {
  it('saves Group / Country / Gar.Define / Sizewise / ColourWise / Excess % / Consumption, shows Qty Details, copies to another order', async () => {
    const label = await prisma.item.update({ where: { id: m.items.label.id }, data: { trimGroup: 'LABEL' } });
    const saved = await owner.put(`/api/v1/orders/${order.id}/trims-bom`, {
      lines: [
        { trimItemId: label.id, country: 'FRANCE', garDefine: 'TOP', sizewise: true, colourwise: false, qtyPerGarment: '1', wastagePct: '4', consumption: 'Flat' },
        { trimItemId: m.items.polybag.id, sizewise: false, colourwise: false, qtyPerGarment: '1', wastagePct: '0' },
      ],
    });
    ok(saved);
    const sizeLabel = saved.body.data.find((l: { trimItemId: string }) => l.trimItemId === label.id);
    expect(sizeLabel).toMatchObject({ country: 'FRANCE', garDefine: 'TOP', sizewise: true, colourwise: false, consumption: 'Flat', trimItem: { trimGroup: 'LABEL' } });
    const orderDetail = (await owner.get(`/api/v1/orders/${order.id}`)).body.data as { sizes: string[]; lines: { size: string; qty: number }[] };
    expect(sizeLabel.qtyDetails.map((d: { size: string }) => d.size).sort()).toEqual([...orderDetail.sizes].sort());
    const firstSize = orderDetail.sizes[0]!;
    const pcs = orderDetail.lines.filter((l) => l.size === firstSize).reduce((a, l) => a + l.qty, 0);
    expect(sizeLabel.qtyDetails.find((d: { size: string }) => d.size === firstSize).required).toBe(String(Math.ceil(pcs * 1.04)));

    const other = await createOrder(owner, m);
    const copied = await owner.get(`/api/v1/orders/${other.id}/trims-bom/copy?fromOrderId=${order.id}`);
    ok(copied);
    expect(copied.body.data).toHaveLength(2);
    expect(copied.body.data[0]).toMatchObject({ sizewise: expect.any(Boolean), consumption: expect.any(String) });
    ok(await owner.get(`/api/v1/orders/${other.id}/trims-bom/copy?fromOrderId=${other.id}`), 400);
  });
});
