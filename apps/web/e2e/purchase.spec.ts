import { type Page, expect, test } from '@playwright/test';
import { docNo, expectStatus, field, login, pick, saveDraft, withReason } from './helpers';

/** Purchase orders (Q-066): yarn PO with the tax panel, approve, revert, re-approve, print. */
test.describe.serial('purchase orders', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page);
  });
  test.afterAll(async () => page.close());

  test('yarn PO: lines and tax worked out live, approved and numbered, reverted, printed', async () => {
    await page.goto('/purchase-orders');
    await expect(page.getByRole('heading', { name: 'Purchase orders' })).toBeVisible();
    await page.getByRole('link', { name: 'Yarn PO' }).click();
    await expect(page.getByRole('heading', { name: /Yarn purchase order/ })).toBeVisible();

    await pick(page, 'Supplier', 'Kaveri');
    await pick(page, /^Order/, 'WW-2627-001');
    await (await field(page, 'Payment terms')).fill('60 days');
    const row = page.locator('tbody tr').first();
    await row.getByRole('button').first().click();
    const search = page.getByPlaceholder('Search by code or name…');
    await search.fill('30s Combed');
    await expect(page.locator('[cmdk-item]').first()).toContainText(/30s Combed/i);
    await page.keyboard.press('Enter');
    await expect(search).toBeHidden();
    const inputs = row.locator('input');
    await inputs.nth(0).fill('Adisankara'); // mill
    await inputs.nth(2).fill('15'); // bags
    await inputs.nth(3).fill('720'); // kg
    await inputs.nth(4).fill('328'); // rate
    const aside = page.locator('main');
    await expect(aside.getByText('2,47,968.00').first()).toBeVisible(); // 2,36,160 + CGST 5,904 + SGST 5,904

    await saveDraft(page);
    await expectStatus(page, 'DRAFT');
    await expect(row.getByRole('button').first()).toContainText('30s Combed');
    await withReason(page, /^Approve$/, 'Approve', 'Rate as negotiated');
    await expectStatus(page, 'APPROVED');
    const no = await docNo(page, 'YP');

    await withReason(page, /Revert approval/, 'Revert approval', 'Supplier revised delivery date');
    await expect(page.getByText(`keeps number ${no}`)).toBeVisible();
    await withReason(page, /^Approve$/, 'Approve', 'Approved again');
    expect(await docNo(page, 'YP')).toBe(no);

    await page.goto(page.url().replace('/purchase-orders/', '/print/purchase-order/'));
    await expect(page.getByText('M/s. Kaveri Spinning Mills')).toBeVisible();
    await expect(page.getByText('Two Lakhs Forty Seven Thousand Nine Hundred and Sixty Eight Only')).toBeVisible();
    await page.screenshot({ path: 'test-results/purchase-order-print.png', fullPage: true });
  });
});
