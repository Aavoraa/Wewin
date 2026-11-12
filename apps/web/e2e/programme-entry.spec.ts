import { type Page, expect, test } from '@playwright/test';
import { apiClient, gridPick, login, pick, uid } from './helpers';

/** Programme Entry (Q-067), laid out like the desktop screen: portion grid, fabric block, yarn grid, Prs.Template, size grid, toolbar. */
test.describe.serial('programme entry', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page);
  });
  test.afterAll(async () => page.close());

  test('NECK RIB portion: fabric block, 30s 96% + lycra 4%, Prs.Template, size grid, Calculate, Save', async () => {
    const portion = uid('NECK RIB');
    const template = uid('GREY PUR + DYEING');
    const api = await apiClient();
    const orders = (await (await api.get('/api/v1/orders?q=WW-2627-001')).json()).data as { id: string; orderNo: string }[];
    const order = orders.find((o) => o.orderNo === 'WW-2627-001')!;
    await page.goto(`/programs/new?orderId=${order.id}&colour=WHITE`);
    await expect(page.getByRole('heading', { name: 'Programme Entry' })).toBeVisible();
    await expect(page.getByLabel('Color / Combo')).toHaveValue('WHITE');
    await expect(page.getByLabel('Order Qty')).toHaveValue('1350');
    for (const h of ['Portion', 'Fab.Colour', 'Print.Colour', 'Fab.Details', 'Yarn Details', 'Grammage', 'Loss Details', 'Yarn Counts', 'Yarn Colour', 'Cons.%', 'Sl', 'Process', 'Loss %']) {
      await expect(page.getByRole('columnheader', { name: h, exact: true }).first()).toBeVisible();
    }

    await page.getByLabel('Portion', { exact: true }).fill(portion);
    await page.getByLabel('Fabric Description').fill('1*1 LYC RIB');
    await page.getByLabel('Grey Gsm').fill('260');
    await page.getByLabel('Final Gsm').fill('260');

    for (const [i, [yarn, pct]] of ([['30s Combed', '96'], ['20D Lycra', '4']] as const).entries()) {
      await page.getByText('Add yarn').click();
      await page.getByLabel(`Consumption % ${i + 1}`).locator('xpath=ancestor::tr').getByRole('button').first().click();
      const search = page.getByPlaceholder('Search by code or name…');
      await search.fill(yarn);
      await expect(page.locator('[cmdk-item]').first()).toContainText(yarn);
      await page.keyboard.press('Enter');
      await expect(search).toBeHidden();
      await page.getByLabel(`Consumption % ${i + 1}`).fill(pct);
    }
    await expect(page.getByText('Total 100%')).toBeVisible();

    await page.getByLabel('Prs.Template').fill(template);
    await page.getByLabel('Process 1').selectOption({ label: 'KNITTING' });
    await page.getByLabel('Loss % 1').fill('0');
    await page.getByText('Add process').click();
    await page.getByLabel('Process 2').selectOption({ label: 'DYEING' });
    await page.getByLabel('Loss % 2').fill('5');

    for (const size of ['2Y', '4Y', '6Y', '8Y', '10Y']) {
      await page.getByLabel(`Act.PcsWgt ${size}`).fill('6');
      await page.getByLabel(`Knit.Dia ${size}`).fill('32');
      await page.getByLabel(`Finish.Dia ${size}`).fill('33');
    }
    await expect(page.getByLabel('Length 2Y')).toBeDisabled(); // With Out Measurement
    await page.getByRole('button', { name: 'Calculate' }).click();
    await expect(page.getByLabel(/Required finished kg/)).toHaveValue('8.100'); // 1,350 pcs × 6 g

    // Wewin details: the items the desktop screen does not show.
    await pick(page, /Finished fabric item/, 'Dyed Single Jersey');
    await gridPick(page, '0:2', '30s Combed');
    await gridPick(page, '0:3', 'Greige Single Jersey');
    await gridPick(page, '1:2', 'Greige Single Jersey');
    await gridPick(page, '1:3', 'Dyed Single Jersey 30s');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page).toHaveURL(/\/programs\/[0-9a-f-]{36}$/);

    const portions = page.locator('table').filter({ hasText: 'Loss Details' });
    await expect(portions.getByText('30s Combed Cotton Yarn 96% + 20D Lycra 4%').first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Portion', { exact: true })).toHaveValue(portion);
    await expect(page.getByLabel('Act.PcsWgt 4Y')).toHaveValue('6');
    await expect(page.getByLabel('Consumption % 2')).toHaveValue('4');
    await expect(page.getByLabel('Prs.Template')).toHaveValue(template);
    await page.screenshot({ path: 'test-results/programme-entry.png', fullPage: true });

    // AddNew → the next portion; picking the saved Prs.Template fills its processes and loss %.
    await page.getByRole('button', { name: 'AddNew' }).click();
    await expect(page).toHaveURL(/\/programs\/new\?orderId=.*colour=WHITE/);
    await page.getByLabel('Prs.Template').fill(template);
    await expect(page.getByLabel('Process 1').locator('option:checked')).toHaveText('KNITTING');
    await expect(page.getByLabel('Process 2').locator('option:checked')).toHaveText('DYEING');
    await expect(page.getByLabel('Loss % 2')).toHaveValue('5');
  });
});
