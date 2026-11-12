import { describe, expect, it } from 'vitest';
import { isYarnProgramProcess, yarnProgramPlan, zYarnProgramInput } from './yarnPrograms';

const id = '00000000-0000-4000-8000-000000000001';
const base = { orderId: id, processId: id, outputItemId: id, allowedLossPct: '2', inputs: [{ itemId: id, mixPct: '100' }] };

describe('yarn programmes (Q-074)', () => {
  it('plans the kg to send: output ÷ (1 − loss %), split by the mix; total = sum of the rows', () => {
    expect(yarnProgramPlan('100', '4', [{ mixPct: '100' }])).toEqual({ sendKg: '104.167', inputs: ['104.167'] });
    expect(yarnProgramPlan('50', '2', [{ mixPct: '96' }, { mixPct: '4' }])).toEqual({ sendKg: '51.021', inputs: ['48.980', '2.041'] });
    expect(yarnProgramPlan('10', '0', [{ mixPct: '100' }])).toEqual({ sendKg: '10.000', inputs: ['10.000'] });
    expect(yarnProgramPlan(null, '4', [{ mixPct: '100' }])).toBeNull();
  });
  it('mix must total 100, each yarn + colour once, loss below 100 %', () => {
    expect(zYarnProgramInput.safeParse(base).success).toBe(true);
    expect(zYarnProgramInput.safeParse({ ...base, inputs: [{ itemId: id, mixPct: '96' }] }).success).toBe(false);
    expect(zYarnProgramInput.safeParse({ ...base, inputs: [{ itemId: id, mixPct: '50' }, { itemId: id, mixPct: '50' }] }).success).toBe(false);
    expect(zYarnProgramInput.safeParse({ ...base, inputs: [{ itemId: id, mixPct: '50', colour: 'RED' }, { itemId: id, mixPct: '50', colour: 'NAVY' }] }).success).toBe(true);
    expect(zYarnProgramInput.safeParse({ ...base, allowedLossPct: '100' }).success).toBe(false);
  });
  it('only the yarn processes have Program Defined', () => {
    expect(['YARN_DYEING', 'YARN_TWISTING', 'YARN_OTHER'].every(isYarnProgramProcess)).toBe(true);
    expect(isYarnProgramProcess('KNITTING')).toBe(false);
  });
});
