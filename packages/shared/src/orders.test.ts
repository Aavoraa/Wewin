import { describe, expect, it } from 'vitest';
import { accessoryQtyDetails, orderTotals, programFinishedKg, programPlan, programYarnNeed, trimsRequirement, zOrderInput, zProgramInput } from './orders';

const id = '00000000-0000-4000-8000-000000000001';
const base = {
  orderNo: 'ww-001',
  buyerId: id,
  buyerPoNo: 'PO-77',
  poDate: '2026-10-01',
  styleNo: 'ST-1',
  garmentItemId: id,
  currency: 'usd',
  colours: ['NAVY', 'RED'],
  sizes: ['S', 'M'],
  lines: [
    { colour: 'NAVY', size: 'S', qty: 100, unitPrice: '3.25' },
    { colour: 'RED', size: 'M', qty: '50', unitPrice: '3.5' },
  ],
  components: [{ code: 'front', name: 'Front', panelItemId: id, pcsPerGarment: 1 }],
};

describe('order schema', () => {
  it('accepts a valid matrix and normalises codes', () => {
    const r = zOrderInput.parse(base);
    expect(r.orderNo).toBe('WW-001');
    expect(r.currency).toBe('USD');
    expect(r.lines[1]!.qty).toBe(50);
    expect(r.components[0]!.code).toBe('FRONT');
  });
  it.each([
    ['duplicate cell', { lines: [base.lines[0], base.lines[0]] }],
    ['unknown colour', { lines: [{ colour: 'GREEN', size: 'S', qty: 1 }] }],
    ['zero qty', { lines: [{ colour: 'NAVY', size: 'S', qty: 0 }] }],
    ['fractional qty', { lines: [{ colour: 'NAVY', size: 'S', qty: 1.5 }] }],
    ['duplicate size', { sizes: ['S', 's'] }],
    ['no components', { components: [] }],
    ['ship before PO', { shipDate: '2026-09-01' }],
  ])('rejects %s', (_n, patch) => {
    expect(zOrderInput.safeParse({ ...base, ...patch }).success).toBe(false);
  });
});

describe('orderTotals', () => {
  it('totals by colour, size and value exactly', () => {
    const t = orderTotals([
      { colour: 'NAVY', size: 'S', qty: 3, unitPrice: '0.1' },
      { colour: 'NAVY', size: 'M', qty: 3, unitPrice: '0.2' },
      { colour: 'RED', size: 'S', qty: 1, unitPrice: '1' },
    ]);
    expect(t).toEqual({ byColour: { NAVY: 6, RED: 1 }, bySize: { S: 4, M: 3 }, pcs: 7, value: '1.90', fullyPriced: true });
  });
  it('flags unpriced lines', () => {
    expect(orderTotals([{ colour: 'A', size: 'S', qty: 1 }]).fullyPriced).toBe(false);
    expect(orderTotals([]).fullyPriced).toBe(false);
  });
});

describe('trimsRequirement', () => {
  const lines = [
    { colour: 'NAVY', size: 'S', qty: 100 },
    { colour: 'NAVY', size: 'M', qty: 200 },
    { colour: 'RED', size: 'S', qty: 50 },
  ];
  it('applies qty per garment and wastage to the whole order', () => {
    expect(trimsRequirement({ qtyPerGarment: '1', wastagePct: '3' }, lines)).toEqual({ garments: 350, required: '360.5000', rounded: '361' });
  });
  it('restricts to colour / size specific BOM lines', () => {
    expect(trimsRequirement({ colour: 'NAVY', qtyPerGarment: '2', wastagePct: '0' }, lines).required).toBe('600.0000');
    expect(trimsRequirement({ colour: 'NAVY', size: 'S', qtyPerGarment: '0.5', wastagePct: '0' }, lines)).toEqual({
      garments: 100,
      required: '50.0000',
      rounded: '50',
    });
    expect(trimsRequirement({ size: 'XL', qtyPerGarment: '1', wastagePct: '5' }, lines).garments).toBe(0);
  });
});

describe('programPlan', () => {
  it('back-calculates input kg through each process from allowed loss', () => {
    const plan = programPlan('1000', [
      { sequence: 1, allowedLossPct: '2' }, // knitting
      { sequence: 2, allowedLossPct: '8' }, // dyeing
    ]);
    expect(plan[2]).toEqual({ outputKg: '1000.000', inputKg: '1086.957' });
    expect(plan[1]).toEqual({ outputKg: '1086.957', inputKg: '1109.139' });
  });
  it('handles zero loss and 100% loss safely', () => {
    expect(programPlan('10', [{ sequence: 1, allowedLossPct: '0' }])[1]).toEqual({ outputKg: '10.000', inputKg: '10.000' });
    expect(programPlan('10', [{ sequence: 1, allowedLossPct: '100' }])[1]!.inputKg).toBe('10.000');
  });
});

describe('programYarnNeed (Q-073)', () => {
  const route = [
    { sequence: 1, allowedLossPct: '2', inputItemId: 'yarn-30s', inputIsYarn: true }, // knitting
    { sequence: 2, allowedLossPct: '8', inputItemId: 'greige', inputIsYarn: false }, // dyeing
    { sequence: 3, allowedLossPct: '1', inputItemId: 'dyed', inputIsYarn: false }, // compacting
  ];
  it('without a yarn mix: the knitting input kg of the first process yarn', () => {
    expect(programYarnNeed({ requiredKg: '500', processes: route, yarnMix: [] })).toEqual([{ yarnItemId: 'yarn-30s', counts: null, colour: null, kg: '560.171' }]);
  });
  it('splits the yarn kg by the mix %, a single-row mix falling back to the first process yarn', () => {
    const mix = [
      { yarnItemId: 'yarn-30s', counts: '30s', colour: 'ecru', consPct: '96' },
      { counts: '20D lycra', consPct: '4' },
    ];
    expect(programYarnNeed({ requiredKg: '100', processes: route, yarnMix: mix })).toEqual([
      { yarnItemId: 'yarn-30s', counts: '30s', colour: 'ecru', kg: '107.553' },
      { yarnItemId: null, counts: '20D lycra', colour: null, kg: '4.481' },
    ]);
    expect(programYarnNeed({ requiredKg: '100', processes: route, yarnMix: [{ counts: '30s', consPct: '100' }] })[0]).toMatchObject({ yarnItemId: 'yarn-30s', kg: '112.034' });
  });
  it('needs no yarn when the first process takes fabric, or with no required kg', () => {
    expect(programYarnNeed({ requiredKg: '100', processes: route.slice(1), yarnMix: [{ counts: '30s', consPct: '100' }] })).toEqual([]);
    expect(programYarnNeed({ requiredKg: null, processes: route, yarnMix: [] })).toEqual([]);
  });
});

describe('programme entry fields (Q-067)', () => {
  const base = {
    orderId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427',
    fabricItemId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427',
    requiredKg: '100',
    processes: [{ sequence: 1, processId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427', inputItemId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427', outputItemId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427', allowedLossPct: '5' }],
  };

  it('accepts the desktop programme: 1*1 LYC RIB, 30s 96% + lycra 4%, size-wise dia', () => {
    const r = zProgramInput.safeParse({
      ...base,
      portion: 'NECK RIB',
      fabricDescription: '1*1 LYC RIB',
      fabricType: 'Knits',
      greyGsm: 260,
      gsm: 260,
      yarnMix: [{ counts: '30s 100% COMBED', consPct: '96' }, { counts: 'LYCRA', consPct: '4' }],
      sizeSpecs: [{ size: '3A', actPcsWeight: '6', knitDia: '32', finishDia: '33' }],
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(r.data?.uom).toBe('Kgs');
  });

  it('needs the yarn mix to add up to 100% and each size once', () => {
    expect(zProgramInput.safeParse({ ...base, yarnMix: [{ counts: '30s', consPct: '90' }] }).success).toBe(false);
    expect(zProgramInput.safeParse({ ...base, sizeSpecs: [{ size: '3A' }, { size: '3A' }] }).success).toBe(false);
  });

  it('Calculate: pieces × actual piece weight (g) ÷ 1000, reporting sizes without a weight', () => {
    const r = programFinishedKg({ '3A': 1500, '4A': 1500, '5A': 0, '6A': 100 }, [
      { size: '3A', actPcsWeight: '6' },
      { size: '4A', actPcsWeight: '6.5' },
    ]);
    expect(r).toEqual({ kg: '18.750', missing: ['6A'] });
  });
});

describe('accessories requirement — Qty Details (Q-069)', () => {
  const matrix = [
    { colour: 'NAVY', size: '4A', qty: 100 },
    { colour: 'NAVY', size: '5A', qty: 150 },
    { colour: 'RED', size: '4A', qty: 50 },
  ];
  it('MAIN LABEL (not sizewise / colourwise), 4% excess: one total, rounded up', () => {
    expect(accessoryQtyDetails({ qtyPerGarment: '1', wastagePct: '4', sizewise: false, colourwise: false }, matrix)).toEqual([{ colour: null, size: null, orderQty: 300, required: '312' }]);
  });
  it('SIZE LABEL sizewise: one row per size', () => {
    expect(accessoryQtyDetails({ qtyPerGarment: '1', wastagePct: '4', sizewise: true, colourwise: false }, matrix)).toEqual([
      { colour: null, size: '4A', orderQty: 150, required: '156' },
      { colour: null, size: '5A', orderQty: 150, required: '156' },
    ]);
  });
  it('SEWING THREAD colourwise, 0.02 cones a garment: per colour, rounded up', () => {
    expect(accessoryQtyDetails({ qtyPerGarment: '0.02', wastagePct: '0', sizewise: false, colourwise: true }, matrix)).toEqual([
      { colour: 'NAVY', size: null, orderQty: 250, required: '5' },
      { colour: 'RED', size: null, orderQty: 50, required: '1' },
    ]);
  });
});

describe('incomplete draft programmes (Q-070)', () => {
  it('a draft may have only the order; programMissing lists what approval still needs', async () => {
    const { programMissing } = await import('./orders');
    expect(zProgramInput.safeParse({ orderId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427', portion: 'BODY + SLV' }).success).toBe(true);
    expect(programMissing({ fabricItemId: null, requiredKg: null, processes: [{ sequence: 1, inputItemId: 'x', outputItemId: null }] })).toEqual(['finished fabric item', 'required finished kg', 'output item of process 1']);
    expect(programMissing({ fabricItemId: 'f', requiredKg: '8.1', processes: [{ sequence: 1, inputItemId: 'a', outputItemId: 'b' }] })).toEqual([]);
  });
});
