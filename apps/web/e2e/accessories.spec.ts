import { type Page, expect, test } from '@playwright/test';
import { apiClient, login, pick, primary, uid } from './helpers';

/** Desktop Accessories menu (Q-072): GRN against the PO, Purchase Return, Replacement, PO Close, Transfer, SPL.Request; Print everywhere. */
test.describe.serial('accessories purchase chain', () => {
  let page: Page;
  let vendor: { id: string; name: string };
  let order: { id: string; orderNo: string };
  let poNo: string;
  const itemName = `E2E Hang tag ${uid('T')}`;

  test.beforeAll(async ({ browser }) => {
    const api = await apiClient();
    vendor = ((await (await api.get('/api/v1/vendors?pageSize=1')).json()).data as { id: string; name: string }[])[0]!;
    order = ((await (await api.get('/api/v1/orders?q=WW-2627-001')).json()).data as { id: string; orderNo: string }[]).find((o) => o.orderNo === 'WW-2627-001')!;
    const item = (await (await api.post('/api/v1/items', { data: { code: uid('ACC'), name: itemName, type: 'TRIM', unit: 'NOS', trimGroup: 'TAG' } })).json()).data as { id: string };
    const po = (await (await api.post('/api/v1/purchase-orders', { data: { kind: 'ACCESSORY', docDate: '2026-11-05', vendorId: vendor.id, orderId: order.id, accessoryType: 'TAG', taxPct: '18', lines: [{ itemId: item.id, size: '4A', qty: '1000', rate: '0.80' }] } })).json()).data as { id: string };
    poNo = ((await (await api.post(`/api/v1/purchase-orders/${po.id}/approve`, { data: { note: 'E2E' } })).json()).data as { docNo: string }).docNo;
    page = await browser.newPage();
    await login(page);
  });
  test.afterAll(async () => page.close());

  test('Purchase Receipt: pending PO lines for the supplier → GRN → posted, printed in the GRN layout', async () => {
    await page.goto('/accessories/RECEIPT');
    await expect(page.getByRole('heading', { name: 'Purchase Receipt' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeVisible(); // every page prints
    await page.getByRole('link', { name: /New purchase receipt/ }).click();
    await pick(page, 'Supplier *', vendor.name);
    const pending = page.getByRole('row').filter({ hasText: poNo });
    await expect(pending).toContainText('1,000');
    await pending.getByRole('button', { name: /Add/ }).click();
    await page.getByLabel('Qty 1').fill('600');
    await page.getByLabel('D.C. No').fill('247');
    await page.getByRole('button', { name: /Save (draft|changes)/ }).click();
    await expect(page).toHaveURL(/\/accessories\/RECEIPT\/[0-9a-f-]{36}$/);
    await primary(page, 'Post');
    await expect(page.locator('h1 .font-mono')).toHaveText(/^TRR\//);
    const popup = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'Print' }).click();
    const print = await popup;
    await expect(print.getByText('Accessories Purchase - GRN', { exact: true })).toBeVisible();
    for (const h of ['P.O.No', 'Our Order Ref', 'Acc.Description', 'Colour', 'Size', 'Qty', 'Uom']) await expect(print.getByRole('columnheader', { name: h, exact: true })).toBeVisible();
    await expect(print.getByText(poNo)).toBeVisible();
    await print.screenshot({ path: 'test-results/accessories-grn-print.png', fullPage: true });
    await print.close();
  });

  test('Purchase Return: received lines → reason → posted; the PO balance reopens', async () => {
    await page.goto('/accessories/RETURN/new');
    await pick(page, 'Supplier *', vendor.name);
    const received = page.getByRole('row').filter({ hasText: poNo });
    await expect(received).toContainText('600');
    await received.getByRole('button', { name: /Add/ }).click();
    await page.getByLabel('Qty 1').fill('50');
    await page.getByLabel('Reason 1').fill('Print smudged');
    await page.getByRole('button', { name: /Save (draft|changes)/ }).click();
    await expect(page).toHaveURL(/\/accessories\/RETURN\/[0-9a-f-]{36}$/);
    await primary(page, 'Post');
    await expect(page.locator('h1 .font-mono')).toHaveText(/^APR\//);
  });

  test('Replacement Inward: pick the return → lines filled → posted', async () => {
    await page.goto('/accessories/REPLACEMENT/new');
    await pick(page, 'Supplier *', vendor.name);
    const sel = page.getByLabel('Against return');
    await expect(sel.locator('option', { hasText: /^APR\// })).toHaveCount(1);
    await sel.selectOption({ index: 1 });
    await expect(page.getByLabel('Qty 1')).toHaveValue('50');
    await page.getByRole('button', { name: /Save (draft|changes)/ }).click();
    await expect(page).toHaveURL(/\/accessories\/REPLACEMENT\/[0-9a-f-]{36}$/);
    await primary(page, 'Post');
    await expect(page.locator('h1 .font-mono')).toHaveText(/^ARI\//);
  });

  test('Purchase Order Close writes off the balance; SPL.Request and Transfer screens open', async () => {
    await page.goto('/accessories/po-close');
    const row = page.getByRole('row').filter({ hasText: poNo });
    await expect(row).toContainText('400'); // 1000 − 600 + 50 − 50
    await row.getByRole('button', { name: 'Close PO' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('Balance not required');
    await dialog.getByRole('button', { name: 'Close PO', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('row').filter({ hasText: poNo })).toHaveCount(0);

    await page.goto('/spl-requests/new');
    await expect(page.getByRole('heading', { name: 'SPL.Request' })).toBeVisible();
    await expect(page.getByText('Order No/Style Ref *')).toBeVisible();
    await page.goto('/accessories/TRANSFER/new');
    await expect(page.getByText('From order *')).toBeVisible();
    await expect(page.getByText('To order *')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Purchase Replacement Inward' })).toBeVisible(); // Accessories menu
    await page.screenshot({ path: 'test-results/accessories-transfer.png', fullPage: true });
  });

  test('a list prints as shown: no menu or buttons, with the company / page / date header', async () => {
    await page.goto('/accessories/RECEIPT');
    await expect(page.getByRole('cell', { name: /^TRR\// }).first()).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByText('Printed', { exact: false }).first()).toBeVisible();
    await expect(page.locator('aside')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeHidden();
    await page.screenshot({ path: 'test-results/accessories-list-print.png', fullPage: true });
    await page.emulateMedia({ media: 'screen' });
  });
});
