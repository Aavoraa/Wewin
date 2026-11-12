import { type PermissionKey } from './permissions';

/**
 * Approvals Wewin can switch off (Q-075). While a switch is off, whoever holds the `from` permission
 * (the one that creates the document) also holds the `approve` permission, so they finalise their
 * own document — no separate approver. Purchase order approval is not switchable.
 */
export const APPROVAL_SWITCHES = [
  { setting: 'programs.approvalRequired', approve: 'programs.approve', from: 'programs.edit' },
  { setting: 'qc.approvalRequired', approve: 'qc.approve', from: 'qc.create' },
  { setting: 'trims.splApprovalRequired', approve: 'trims.spl.approve', from: 'trims.create' },
] as const satisfies readonly { setting: string; approve: PermissionKey; from: PermissionKey }[];

export type ApprovalSwitchSetting = (typeof APPROVAL_SWITCHES)[number]['setting'];

/** A user's role permissions plus the approve permissions granted because an approval is switched off. */
export function withApprovalSwitches(perms: Iterable<string>, required: Record<ApprovalSwitchSetting, boolean>): Set<string> {
  const out = new Set(perms);
  for (const s of APPROVAL_SWITCHES) {
    if (!required[s.setting] && out.has(s.from)) out.add(s.approve);
  }
  return out;
}
