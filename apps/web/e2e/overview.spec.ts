import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { type Page, expect, test } from '@playwright/test';
import { login, uid } from './helpers';

/** Step 12 screens: dashboard, reports with background Excel, attachments, opening-data import. */
test.describe.serial('dashboard, reports, attachments, opening data', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page);
  });
  test.afterAll(async () => page.close());

  test('dashboard shows live tiles', async () => {
    await page.goto('/');
    for (const t of ['Open orders', 'At job workers', 'Active alerts', 'Vendor payables', 'Export receivables']) {
      await expect(page.getByRole('main').getByText(t, { exact: true })).toBeVisible();
    }
  });

  test('reports: run on screen, build Excel in the background, download it', async () => {
    await page.goto('/reports');
    await page.getByRole('button', { name: 'Stock balances' }).click();
    await page.getByRole('button', { name: 'Show report' }).click();
    await expect(page.getByText(/\d+ rows?/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Download Excel' }).click();
    const ready = page.getByText('READY').first();
    await expect(ready).toBeVisible({ timeout: 30_000 });
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /rows/ }).first().click()]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await readFile(await download.path())) as never);
    expect(wb.worksheets[0]!.rowCount).toBeGreaterThan(1);
  });

  test('attachments: attach a PDF to an order, see it listed, remove it', async () => {
    await page.goto('/orders');
    await page.getByRole('row').nth(1).click();
    await expect(page.getByRole('heading', { name: 'Attachments' })).toBeVisible();
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF');
    await page.getByLabel('Attach files').setInputFiles({ name: 'buyer-po-e2e.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page.getByText('buyer-po-e2e.pdf').first()).toBeVisible();
    await page.getByRole('button', { name: 'Remove buyer-po-e2e.pdf' }).click();
    await expect(page.getByText('buyer-po-e2e.pdf')).toHaveCount(0);
  });

  test('opening data: template → filled file → problems → post → opening bill', async () => {
    await page.goto('/settings/opening');
    await page.getByRole('button', { name: /Vendor balances/ }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download vendor balances template' }).click()]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await readFile(await download.path())) as never);
    const ref = uid('OB');
    const ws = wb.getWorksheet('Balances')!;
    ws.addRow(['MIL-KSM', ref, '15-08-2026', '', '125000', 'Yarn bill carried forward']);
    ws.addRow(['NO-SUCH', `${ref}-X`, '15-08-2026', '', '10', '']);
    const withProblem = Buffer.from(await wb.xlsx.writeBuffer());
    await page.getByLabel('Opening data file').setInputFiles({ name: 'balances.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: withProblem });
    await expect(page.getByText('Unknown vendor NO-SUCH')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Post / })).toBeDisabled();
    await page.getByRole('button', { name: 'Discard' }).click();

    ws.spliceRows(3, 1);
    const clean = Buffer.from(await wb.xlsx.writeBuffer());
    await page.getByLabel('Opening data file').setInputFiles({ name: 'balances.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: clean });
    await expect(page.getByText('No problems found.')).toBeVisible();
    await page.getByRole('button', { name: 'Post 1 rows' }).click();
    const link = page.getByRole('link', { name: new RegExp(`BILL/.*${ref}`) });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByText(ref).first()).toBeVisible();
    await expect(page.getByText('POSTED').first()).toBeVisible();
  });

  test('voice: the assistant opens with Alt+V and a spoken command opens a screen (no AI needed)', async () => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Voice command (Alt+V)' })).toBeVisible();
    await page.keyboard.press('Alt+v');
    const dialog = page.getByRole('dialog', { name: 'Ask or command' });
    await expect(dialog).toBeVisible();
    // Headless Chromium has no speech service; typing goes through the same path as recognised speech.
    await dialog.getByLabel('What you said').fill('open packing lists');
    await dialog.getByLabel('What you said').press('Enter');
    await expect(page).toHaveURL(/\/packing-lists$/);
    await expect(page.getByRole('heading', { name: 'Packing lists' })).toBeVisible();
  });
});
