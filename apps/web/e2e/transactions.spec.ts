import { expect, test } from '@playwright/test';
import { login } from './helpers';

/** Desktop Transaction menu (Q-071): one screen per process with Rate Quotation, Delivery, Inward/Return, Job Close. */
test('Transaction › Fabric Dyeing: four tabs, only dyeing documents', async ({ page }) => {
  await login(page);
  await page.goto('/transactions/DYEING');
  await expect(page.getByRole('heading', { name: 'Fabric Dyeing' })).toBeVisible();
  for (const t of ['Rate Quotation', 'Fabric Delivery', 'Fabric Inward/Return', 'Job Close']) await expect(page.getByRole('button', { name: t, exact: true })).toBeVisible();

  // Delivery: the demo's dyeing D.C.s, none of the knitting ones.
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  await expect(page.locator('tbody')).not.toContainText('Knitting');
  await page.getByRole('button', { name: 'Fabric Inward/Return', exact: true }).click();
  await expect(rows.first()).toBeVisible();
  await page.getByRole('button', { name: 'Job Close', exact: true }).click();
  await expect(page.getByText(/Deliveries still open at the job worker/)).toBeVisible();
  await page.getByRole('button', { name: 'Rate Quotation', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Rate Quotation — Fabric Dyeing/ })).toBeVisible();
  await page.getByRole('button', { name: 'Fabric Delivery', exact: true }).click();
  await page.screenshot({ path: 'test-results/transactions.png' });

  // A new process from the menu opens too (no documents yet is fine).
  await page.getByRole('link', { name: 'Yarn Twisting' }).click();
  await expect(page.getByRole('heading', { name: 'Yarn Twisting' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yarn Delivery', exact: true })).toBeVisible();
});
