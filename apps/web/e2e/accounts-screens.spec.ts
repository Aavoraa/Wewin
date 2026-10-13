import { type Page, expect, test } from '@playwright/test';
import { cell, docNo, expectStatus, login, pick, primary, saveDraft } from './helpers';

/** Accounts screens not covered by the full workflow: rates, manual debit note, reports, alerts, bell. */
test.describe.serial('accounts screens', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page);
  });
  test.afterAll(async () => page.close());

  test('rate contracts list the seeded rates and open for editing', async () => {
    await page.goto('/rate-contracts');
    const row = page.getByRole('row', { name: /Sri Murugan Knitting.*Knitting/ }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('18');
    await row.getByRole('button', { name: /Edit/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(/Rate ₹/)).toHaveValue('18');
    await dialog.getByRole('button', { name: 'Dismiss dialog' }).click();
  });

  test('manual debit note: lines, GST note, post, print', async () => {
    await page.goto('/debit-notes/new');
    await pick(page, 'Vendor *', 'Arun Screen');
    await cell(page, '0:0', 'Damaged print screens returned');
    await cell(page, '0:1', '2');
    await cell(page, '0:3', '150');
    await expect(page.getByText('Taxable').locator('xpath=..')).toContainText('300.00');
    await saveDraft(page);
    await primary(page);
    await expectStatus(page, 'POSTED');
    const no = await docNo(page, 'DN');
    const href = await page.getByRole('link', { name: /Print/ }).getAttribute('href');
    expect(href).toMatch(/^\/print\/debit-note\//);
    await page.goto(href!); // the button opens a new tab; load it here
    await expect(page.getByText(no, { exact: true })).toBeVisible();
  });

  test('pending D.C.s report and alerts check', async () => {
    await page.goto('/reports/pending-dcs');
    await expect(page.getByRole('heading', { name: /Pending D\.C\.s/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Download ITC-04 workbook/ })).toBeEnabled();
    await page.goto('/alerts');
    await page.getByRole('button', { name: /Run checks now/ }).click();
    await expect(page.getByText(/Checks done: \d+ new, \d+ resolved/)).toBeVisible();
  });

  test('notifications bell opens the list', async () => {
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await expect(page.getByText('Notifications', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  });
});
