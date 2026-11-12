import { describe, expect, it } from 'vitest';
import { withApprovalSwitches } from './approvals';

const allOn = { 'programs.approvalRequired': true, 'qc.approvalRequired': true, 'trims.splApprovalRequired': true };

describe('approval switches (Q-074)', () => {
  it('changes nothing while every approval is required', () => {
    expect([...withApprovalSwitches(['qc.create', 'programs.edit', 'trims.create'], allOn)].sort()).toEqual(['programs.edit', 'qc.create', 'trims.create']);
  });

  it('an approval switched off goes to whoever creates that document', () => {
    const p = withApprovalSwitches(['qc.create', 'programs.edit'], { ...allOn, 'qc.approvalRequired': false, 'programs.approvalRequired': false });
    expect(p.has('qc.approve')).toBe(true);
    expect(p.has('programs.approve')).toBe(true);
    expect(p.has('trims.spl.approve')).toBe(false);
  });

  it('never grants an approval to someone who cannot create the document', () => {
    const p = withApprovalSwitches(['qc.view'], { ...allOn, 'qc.approvalRequired': false });
    expect(p.has('qc.approve')).toBe(false);
  });
});
