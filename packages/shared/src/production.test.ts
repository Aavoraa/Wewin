import { describe, expect, it } from 'vitest';
import { garmentSets, generateBundles, panelShortfall, sewingConsumption } from './production';

const components = [
  { code: 'FRONT', pcsPerGarment: 1 },
  { code: 'BACK', pcsPerGarment: 1 },
  { code: 'SLEEVE', pcsPerGarment: 2 },
];

describe('generateBundles', () => {
  it('ratio × plies garments, per component, split into bundles', () => {
    const b = generateBundles({ components, sizeRatios: [{ size: 'S', ratio: 1 }, { size: 'M', ratio: 2 }], plies: 30, pcsPerBundle: 25 });
    const sum = (code: string, size: string) => b.filter((x) => x.componentCode === code && x.size === size).reduce((a, x) => a + x.pcs, 0);
    expect(sum('FRONT', 'S')).toBe(30);
    expect(sum('SLEEVE', 'S')).toBe(60);
    expect(sum('BACK', 'M')).toBe(60);
    expect(b.every((x) => x.pcs <= 25)).toBe(true);
    expect(b.filter((x) => x.componentCode === 'FRONT' && x.size === 'S').map((x) => x.pcs)).toEqual([25, 5]);
  });
  it('skips zero ratios and validates input', () => {
    expect(generateBundles({ components, sizeRatios: [{ size: 'S', ratio: 0 }], plies: 10, pcsPerBundle: 20 })).toEqual([]);
    expect(() => generateBundles({ components, sizeRatios: [], plies: 0, pcsPerBundle: 20 })).toThrow();
    expect(() => generateBundles({ components, sizeRatios: [], plies: 1, pcsPerBundle: 0 })).toThrow();
    expect(() => generateBundles({ components, sizeRatios: [{ size: 'S', ratio: 1.5 }], plies: 1, pcsPerBundle: 1 })).toThrow();
  });
});

describe('garmentSets', () => {
  it('is limited by the scarcest component', () => {
    expect(garmentSets({ FRONT: 100, BACK: 98, SLEEVE: 210 }, components)).toBe(98);
    expect(garmentSets({ FRONT: 100, BACK: 100, SLEEVE: 150 }, components)).toBe(75);
    expect(garmentSets({}, components)).toBe(0);
    expect(garmentSets({ X: 1 }, [])).toBe(0);
  });
});

describe('panelShortfall (A§7.2)', () => {
  it('missing = sent − good − rejected; values rejected + missing at panel cost', () => {
    expect(panelShortfall({ sent: 500, good: 480, rejected: 12, panelCostPerPiece: '7.5' })).toEqual({
      sent: 500,
      good: 480,
      rejected: 12,
      missing: 8,
      debitPcs: 20,
      rejectedValue: '90.00',
      missingValue: '60.00',
      debitValue: '150.00',
    });
  });
  it('zero shortfall, and unvalued when no panel cost is set', () => {
    expect(panelShortfall({ sent: 10, good: 10, rejected: 0, panelCostPerPiece: '5' }).debitValue).toBe('0.00');
    expect(panelShortfall({ sent: 10, good: 8, rejected: 1 })).toMatchObject({ missing: 1, debitPcs: 2, debitValue: null });
  });
  it('refuses over-returns and invalid counts', () => {
    expect(() => panelShortfall({ sent: 10, good: 9, rejected: 2 })).toThrow(/more than/);
    expect(() => panelShortfall({ sent: 10, good: -1, rejected: 0 })).toThrow();
    expect(() => panelShortfall({ sent: 10.5, good: 0, rejected: 0 })).toThrow();
  });
});

describe('sewingConsumption', () => {
  it('consumes pcs-per-garment of every component for each colour / size', () => {
    const c = sewingConsumption([{ colour: 'NAVY', size: 'M', pcs: 40 }], [
      { code: 'FRONT', panelItemId: 'f', pcsPerGarment: 1 },
      { code: 'SLEEVE', panelItemId: 's', pcsPerGarment: 2 },
    ]);
    expect(c).toEqual([
      { componentCode: 'FRONT', panelItemId: 'f', colour: 'NAVY', size: 'M', pcs: 40 },
      { componentCode: 'SLEEVE', panelItemId: 's', colour: 'NAVY', size: 'M', pcs: 80 },
    ]);
  });
});
