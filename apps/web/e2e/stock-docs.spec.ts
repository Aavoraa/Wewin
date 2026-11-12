import { type Page, expect, test } from '@playwright/test';
import { login, primary, uid } from './helpers';

/** Desktop Transaction menu: Yarn/Fabric Other Inw/Del, Yarn Transfer Between Order, Rejection Entry, Direct Delivery Receipt (Q-071). */
test.describe.serial('other inward / delivery, transfers, rejections, direct delivery', () => {
  let page: Page;
  const lot = uid('LOT');
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page);
  });
  test.afterAll(async () => page.close());

  async function fillLine(qty: string, bags: string) {
    const row = page.locator('tbody tr').first();
    await row.getByRole('button').first().click();
    const search = page.getByPlaceholder('Search by code or name…');
    await search.fill('30s Combed');
    await expect(page.locator('[cmdk-item]').first()).toContainText(/30s Combed/i);
    await page.keyboard.press('Enter');
    await expect(search).toBeHidden();
    await page.getByLabel('LotNo 1').fill(lot);
    if (bags) await page.getByLabel(/Bag 1$/).fill(bags);
    await page.getByLabel(/(Kgs|Qty) 1$/).fill(qty);
  }

  test('Inward from Others → into the yarn store', async () => {
    await page.goto('/stock-docs/OTHER_DELIVERY');
    await expect(page.getByRole('heading', { name: 'Yarn/Fabric Other Inw/Del' })).toBeVisible();
    await page.getByRole('button', { name: 'Inward from Others' }).click();
    await page.getByRole('link', { name: /New inward from others/ }).click();
    await page.getByLabel('Purpose *').fill('Return of loan');
    await page.getByLabel('Received From').fill('Sister unit, Avinashi');
    await fillLine('25', '1');
    await page.getByRole('button', { name: /Save (draft|changes)/ }).click();
    await expect(page).toHaveURL(/\/stock-docs\/OTHER_INWARD\/[0-9a-f-]{36}$/);
    await primary(page, 'Post');
    await expect(page.locator('h1 .font-mono')).toHaveText(/^OIN\//);
  });

  test('Delivery to Others: Purpose, Delivery To, bags / kg, Gross Wgt, Cone, Delivered By, Vech.No → out of the store', async () => {
    await page.goto('/stock-docs/OTHER_DELIVERY/new');
    await page.getByLabel('Purpose *').fill('Sample');
    await page.getByLabel('Delivery To').fill('Buyer sampling room');
    await fillLine('10', '1');
    await page.getByLabel('Gross Wgt').fill('10.4');
    await page.getByLabel('Cone').fill('12');
    await page.getByLabel('Delivered By').fill('Murugesan');
    await page.getByLabel('Vech.No').fill('TN39 AB 1234');
    await expect(page.getByText('Tot.Del.Kgs')).toBeVisible();
    await page.getByRole('button', { name: /Save (draft|changes)/ }).click();
    await expect(page).toHaveURL(/\/stock-docs\/OTHER_DELIVERY\/[0-9a-f-]{36}$/);
    await primary(page, 'Post');
    await expect(page.locator('h1 .font-mono')).toHaveText(/^ODL\//);
    await page.screenshot({ path: 'test-results/other-delivery.png', fullPage: true });
  });

  test('Transfer, Rejection and Direct Delivery screens open from the Transaction menu', async () => {
    await page.goto('/stock-docs/ORDER_TRANSFER/new');
    await expect(page.getByText('From order *')).toBeVisible();
    await expect(page.getByText('To order *')).toBeVisible();
    await page.goto('/stock-docs/REJECTION/new');
    await expect(page.getByText('Vendor responsible')).toBeVisible();
    await expect(page.getByText('Raise a draft debit note on posting')).toBeVisible();
    await page.goto('/direct-delivery');
    await expect(page.getByRole('heading', { name: 'Direct Delivery Receipt' })).toBeVisible();
    await page.getByRole('button', { name: 'Sent on directly' }).click();
    await expect(page.getByRole('link', { name: 'Rejection Entry' })).toBeVisible(); // Transaction menu entry
  });
});
