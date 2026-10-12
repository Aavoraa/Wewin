import { describe, expect, it } from 'vitest';
import { orderTotals, programPlan, trimsRequirement, zOrderInput } from './orders';

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
