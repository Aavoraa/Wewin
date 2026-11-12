/**
 * Wewin's choice (Q-075): only purchase orders need owner approval. Switches every other approval off
 * on the database in .env through the settings service (audited). Re-runnable.
 *
 *   pnpm --filter @wewin/api approvals:off
 */
process.env.LOG_LEVEL = 'warn';
const { settingsService } = await import('../src/core/settings/settings.service');
const { prisma } = await import('../src/core/db');

const OFF = [
  'jobwork.outwardApprovalRequired',
  'cutting.layApprovalRequired',
  'programs.approvalRequired',
  'qc.approvalRequired',
  'trims.splApprovalRequired',
  'accounts.billVarianceApprovalRequired',
] as const;

for (const key of OFF) {
  await settingsService.set(key, false);
  console.warn(`${key} = false`);
}
await prisma.$disconnect();
