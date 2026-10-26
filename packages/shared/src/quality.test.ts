import { describe, expect, it } from 'vitest';
import { qcLineIssues, qcPackable, qcTotals, zQcInput } from './quality';

const line = (over: object = {}) => ({ defects: [], ...over });

describe('quality checks (Q-063)', () => {
  it('final lines: passed + rejected must equal checked; colour × size once', () => {
    expect(qcLineIssues('FINAL', [line({ colour: 'NAVY', size: '2Y', checkedPcs: 10, passedPcs: 9, rejectedPcs: 1 })])).toEqual([]);
    expect(qcLineIssues('FINAL', [line({ colour: 'NAVY', size: '2Y', checkedPcs: 10, passedPcs: 8, rejectedPcs: 1 })])[0]?.message).toContain('must equal checked (10)');
    const twice = qcLineIssues('FINAL', [line({ colour: 'NAVY', size: '2Y', checkedPcs: 1, passedPcs: 1 }), line({ colour: 'NAVY', size: '2Y', checkedPcs: 1, passedPcs: 1 })]);
    expect(twice.map((i) => i.message)).toContain('NAVY / 2Y is listed twice');
    expect(qcLineIssues('FINAL', [line({ checkedPcs: 1, passedPcs: 1 })]).map((i) => i.path.at(-1))).toEqual(['colour', 'size']);
  });

  it('inline lines: defective cannot exceed checked; defects need defective pieces', () => {
    expect(qcLineIssues('INLINE', [line({ checkedPcs: 5, rejectedPcs: 6 })])[0]?.message).toContain('cannot exceed');
    expect(qcLineIssues('INLINE', [line({ checkedPcs: 5, rejectedPcs: 0, defects: [{ code: 'Hole', count: 1 }] })])[0]?.message).toContain('no rejected');
    expect(qcLineIssues('INLINE', [line({ checkedPcs: 0 })])[0]?.path).toEqual(['lines', 0, 'checkedPcs']);
  });

  it('fabric lines: roll and result required, a roll once', () => {
    expect(qcLineIssues('FABRIC_ROLL', [line()]).map((i) => i.path.at(-1))).toEqual(['rollId', 'result']);
    const id = '7d2b8a4e-1d8f-4b8e-9c6a-2f1d3e4a5b6c';
    expect(qcLineIssues('FABRIC_ROLL', [line({ rollId: id, result: 'PASS' }), line({ rollId: id, result: 'HOLD' })])[0]?.message).toBe('This roll is listed twice');
  });

  it('totals and defect % (one decimal, half up)', () => {
    expect(qcTotals('FINAL', [{ checkedPcs: 12, passedPcs: 11, rejectedPcs: 1 }])).toEqual({ checked: 12, passed: 11, rejected: 1, defectPct: '8.3' });
    expect(qcTotals('INLINE', [{ checkedPcs: 40, rejectedPcs: 1 }, { checkedPcs: 40, rejectedPcs: 0 }])).toEqual({ checked: 80, passed: 79, rejected: 1, defectPct: '1.3' });
    expect(qcTotals('INLINE', [])).toMatchObject({ checked: 0, defectPct: '0.0' });
    expect(qcTotals('FABRIC_ROLL', [{ result: 'PASS' }, { result: 'HOLD' }, { result: 'PASS' }])).toEqual({ rolls: 3, pass: 2, hold: 1, reject: 0 });
  });

  it('packable = passed − packed, never negative', () => {
    expect(qcPackable(11, 10)).toBe(1);
    expect(qcPackable(5, 9)).toBe(0);
  });

  it('header rules: order for piece checks, line for inline checks', () => {
    const r = zQcInput.safeParse({ kind: 'INLINE', docDate: '2026-10-21', lines: [{ checkedPcs: 1 }] });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['orderId', 'sewingLine']));
    expect(zQcInput.safeParse({ kind: 'FABRIC_ROLL', docDate: '2026-10-21', lines: [{ rollId: '7d2b8a4e-1d8f-4b8e-9c6a-2f1d3e4a5b6c', result: 'PASS' }] }).success).toBe(true);
  });
});
