import { type Page, expect, test } from '@playwright/test';
import { apiClient, cell, field, gridPick, login, pick, saveDraft, uid } from './helpers';

/** Programme entry (Q-067): the desktop fields on a fabric programme — portion, yarn mix, size-wise grid, Calculate. */
test.describe.serial('programme entry', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page);
  });
  test.afterAll(async () => page.close());

  test('NECK RIB portion: fabric details, 30s 96% + lycra 4%, piece weights, Calculate, portions table', async () => {
    const portion = uid('NECK RIB');
    const api = await apiClient();
    const orders = (await (await api.get('/api/v1/orders?q=WW-2627-001')).json()).data as { id: string; orderNo: string }[];
    const order = orders.find((o) => o.orderNo === 'WW-2627-001')!;
    await page.goto(`/programs/new?orderId=${order.id}&colour=WHITE`);
    await expect(page.getByText(/Portions — WW-2627-001 · WHITE · order qty 1,350/)).toBeVisible();

    await pick(page, /Finished fabric/, 'Dyed Single Jersey');
    await (await field(page, 'Portion')).fill(portion);
    await (await field(page, 'Fabric description')).fill('1*1 LYC RIB');
    await (await field(page, 'Grey GSM')).fill('260');
    await (await field(page, 'Final GSM')).fill('260');
    await (await field(page, 'Process template')).fill('GREY PUR + DYEING (KGS)');

    for (const [i, [yarn, pct]] of ([['30s Combed', '96'], ['20D Lycra', '4']] as const).entries()) {
      await page.getByRole('button', { name: 'Add yarn' }).click();
      await page.locator('tbody').filter({ has: page.getByLabel(`Consumption % ${i + 1}`) }).locator('tr').nth(i).getByRole('button').first().click();
      const search = page.getByPlaceholder('Search by code or name…');
      await search.fill(yarn);
      await expect(page.locator('[cmdk-item]').first()).toContainText(yarn);
      await page.keyboard.press('Enter');
      await expect(search).toBeHidden();
      await page.getByLabel(`Consumption % ${i + 1}`).fill(pct);
    }
    await expect(page.getByText('100%', { exact: true })).toBeVisible();

    for (const size of ['2Y', '4Y', '6Y', '8Y', '10Y']) {
      await page.getByLabel(`Act. pcs wgt (g) ${size}`).fill('6');
      await page.getByLabel(`Knit dia ${size}`).fill('32');
      await page.getByLabel(`Finish dia ${size}`).fill('33');
    }
    await page.getByRole('button', { name: 'Calculate' }).click();
    await expect(page.getByLabel(/Required finished kg/)).toHaveValue('8.100'); // 1,350 pcs × 6 g

    await page.locator('[data-cell="0:1"]').selectOption({ label: 'Knitting' });
    await gridPick(page, '0:2', '30s Combed');
    await gridPick(page, '0:3', 'Greige Single Jersey');
    await cell(page, '0:4', '0');
    await page.getByRole('button', { name: 'Add process' }).click();
    await page.locator('[data-cell="1:1"]').selectOption({ label: 'Dyeing' });
    await gridPick(page, '1:3', 'Dyed Single Jersey 30s');
    await cell(page, '1:4', '5');
    await saveDraft(page);

    const portions = page.locator('table').filter({ hasText: 'Loss details' });
    await expect(portions.getByRole('link', { name: portion })).toBeVisible();
    await expect(portions.locator('tr', { hasText: portion }).getByText('30s Combed Cotton Yarn 96% + 20D Lycra 4%')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Act. pcs wgt (g) 4Y')).toHaveValue('6');
    await expect(page.getByLabel('Consumption % 2')).toHaveValue('4');
    await page.screenshot({ path: 'test-results/programme-entry.png', fullPage: true });
  });
});
