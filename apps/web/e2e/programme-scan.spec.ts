import { expect, test } from '@playwright/test';
import { programmeScreenPdf } from '../../api/test/invoice-fixtures';
import { cell, gridPick, login, pick, uid } from './helpers';

/**
 * A screenshot of the desktop Programme Entry screen uploaded to Scan invoices (Q-068): recognised as a
 * fabric programme (not an invoice or D.C.), the order suggested from the desktop order ref and confirmed,
 * then "Create programme" opens the programme form filled from it; saving marks the scan as used.
 */
test.describe.serial('programme screenshot scanning', () => {
  test('upload → Fabric programme → confirm order → Create programme → saved, scan used', async ({ page }) => {
    await login(page);
    await page.goto('/scans');
    const ref = `O/0001/WKF/25/KT-101 ${uid('E2E')}`;
    await page.locator('input[type=file]').setInputFiles({ name: 'programme-entry.pdf', mimeType: 'application/pdf', buffer: await programmeScreenPdf(ref, 'WHITE') });
    await expect(page).toHaveURL(/\/scans\/[0-9a-f-]{36}$/);
    const scanUrl = page.url();

    // Recognised as a programme: no supplier box, no invoice lines; the order is suggested from the ref.
    await expect(page.getByLabel('Create as *')).toHaveValue('PROGRAM', { timeout: 30_000 });
    await expect(page.getByText(ref)).toBeVisible();
    await expect(page.getByText('Job worker *')).toBeHidden();
    await expect(page.getByText(/Lines · /)).toBeHidden();
    await expect(page.getByRole('button', { name: /Create programme/ })).toBeDisabled();
    await page.getByRole('radio', { name: /WW-2627-001/ }).click();
    await expect(page.getByText('Order confirmed')).toBeVisible();
    await expect(page.getByText('All checks passed')).toBeVisible();

    await page.getByRole('button', { name: /Create programme/ }).click();
    await expect(page).toHaveURL(/\/programs\/new\?fromScan=/);
    await expect(page.getByText('From the scanned Programme Entry screenshot')).toBeVisible();
    await expect(page.getByLabel(/^Colour/)).toHaveValue('WHITE');

    // The local reader gets the order and colour only; the rest is entered on the form.
    await pick(page, /Finished fabric/, 'Dyed Single Jersey');
    await page.getByLabel(/Required finished kg/).fill('12');
    await page.locator('[data-cell="0:1"]').selectOption({ label: 'Grey fabric purchase' });
    await gridPick(page, '0:2', 'Greige Single Jersey');
    await gridPick(page, '0:3', 'Greige Single Jersey');
    await cell(page, '0:4', '0');
    await page.getByRole('button', { name: /Save (draft|changes)/ }).click();
    await expect(page).toHaveURL(/\/programs\/[0-9a-f-]{36}$/);

    await page.goto(scanUrl);
    await expect(page.getByText(/Draft created/).first()).toBeVisible();
    await page.screenshot({ path: 'test-results/programme-scan.png', fullPage: true });
  });
});
