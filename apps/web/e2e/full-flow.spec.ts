import { type Page, expect, test } from '@playwright/test';
import { apiClient, cell, docNo, expectStatus, field, gridPick, idFromUrl, login, pick, primary, saveDraft, uid, withReason } from './helpers';

/**
 * Full workflow through the UI (Brief §8): order → yarn receipt → outward D.C. → inward D.C. →
 * cutting → panels → sewing → packing (→ accounts and export are added with Phases 3–4).
 */
test.describe.serial('full order workflow', () => {
  let page: Page;
  const orderNo = uid('E2E');
  const yarnLot = uid('YL');
  const s: Record<string, string> = {};

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page);
  });
  test.afterAll(async () => page.close());

  test('create and confirm an order with a colour × size matrix', async () => {
    await page.goto('/orders/new');
    await page.getByLabel(/^Order no\./).fill(orderNo);
    await pick(page, 'Buyer *', 'Nordic');
    await page.getByLabel(/^Buyer PO no\./).fill(`PO-${orderNo}`);
    await page.getByLabel(/^Style no\./).fill('KT-E2E');
    await pick(page, /Style item/, 'KT-101');
    for (const c of ['NAVY']) {
      await page.getByLabel('Colours', { exact: true }).fill(c);
      await page.keyboard.press('Enter');
    }
    for (const sz of ['S', 'M']) {
      await page.getByLabel('Sizes (in order)', { exact: true }).fill(sz);
      await page.keyboard.press('Enter');
    }
    await page.getByLabel('NAVY S quantity').fill('50');
    await page.getByLabel('NAVY M quantity').fill('50');
    await page.getByLabel('S price').fill('3.25');
    await page.getByLabel('M price').fill('3.40');
    await expect(page.getByText('USD 332.50').or(page.getByText('EUR 332.50'))).toBeVisible();
    // Components: FRONT (default row), BACK, SLEEVE × 2
    await cell(page, '0:1', 'Front');
    await gridPick(page, '0:2', 'Front panel');
    await page.getByRole('button', { name: 'Add component' }).click();
    await cell(page, '1:0', 'BACK');
    await cell(page, '1:1', 'Back');
    await gridPick(page, '1:2', 'Back panel');
    await cell(page, '1:3', '1');
    await page.getByRole('button', { name: 'Add component' }).click();
    await cell(page, '2:0', 'SLEEVE');
    await cell(page, '2:1', 'Sleeve');
    await gridPick(page, '2:2', 'Sleeve panel');
    await cell(page, '2:3', '2');
    await saveDraft(page);
    s.orderId = idFromUrl(page);
    await primary(page, 'Confirm');
    await expectStatus(page, 'CONFIRMED');
  });

  test('costing: panel cost per piece', async () => {
    await page.getByRole('button', { name: 'Costing', exact: true }).click();
    await page.getByText('Panel cost / piece').locator('xpath=..').locator('input').fill('7.5');
    await page.getByRole('button', { name: 'Save costing' }).click();
    await expect(page.getByText('Costing saved')).toBeVisible();
  });

  test('fabric program with allowed loss per process, approved', async () => {
    await page.getByRole('button', { name: 'Fabric programs', exact: true }).click();
    await page.getByRole('link', { name: 'New fabric program' }).click();
    await pick(page, /Finished fabric/, 'Dyed Single Jersey');
    await (await field(page, /^Colour/)).selectOption('NAVY');
    await page.getByLabel(/Required finished kg/).fill('50');
    await page.locator('[data-cell="0:1"]').selectOption({ label: 'Knitting' });
    await gridPick(page, '0:2', '30s Combed');
    await gridPick(page, '0:3', 'Greige Single Jersey');
    await cell(page, '0:4', '2');
    await cell(page, '0:5', '285');
    await page.getByRole('button', { name: 'Add process' }).click();
    await page.locator('[data-cell="1:1"]').selectOption({ label: 'Dyeing' });
    await gridPick(page, '1:3', 'Dyed Single Jersey 30s');
    await cell(page, '1:4', '8');
    await cell(page, '1:5', '315');
    await saveDraft(page);
    await primary(page, 'Approve');
    await expectStatus(page, 'APPROVED');
  });

  test('yarn receipt posted into the yarn store', async () => {
    await page.goto('/yarn-receipts/new');
    await pick(page, /Mill \/ supplier/, 'Kaveri');
    await page.getByLabel(/Supplier invoice no/).fill(`INV-${yarnLot}`);
    await gridPick(page, '0:0', '30s Combed');
    await cell(page, '0:1', yarnLot);
    await cell(page, '0:2', '2');
    await cell(page, '0:3', '80');
    await cell(page, '0:4', '285');
    await saveDraft(page);
    await primary(page);
    await expectStatus(page, 'POSTED');
    s.yrn = await docNo(page, 'YRN');
  });

  async function outward(process: RegExp, vendor: string, fill: () => Promise<void>) {
    await page.goto('/outward-dcs/new');
    await pick(page, 'Order *', orderNo);
    const sel = await field(page, /Program process/);
    await expect(sel.locator('option', { hasText: process })).toHaveCount(1);
    await sel.selectOption((await sel.locator('option', { hasText: process }).getAttribute('value'))!);
    await pick(page, /Job worker/, vendor);
    await fill();
    await saveDraft(page);
    await primary(page);
    await expectStatus(page, 'POSTED');
    return { id: idFromUrl(page), no: await docNo(page, 'YDC') };
  }

  test('outward D.C. of yarn to the knitter', async () => {
    const o = await outward(/Knitting/, 'Sri Murugan', async () => {
      await cell(page, '0:2', yarnLot);
      await cell(page, '0:5', '70');
    });
    s.knitOut = o.id;
    s.knitOutNo = o.no;
    await expect(page.getByText('Running loss')).toBeVisible();
  });

  test('inward D.C. of greige rolls with live loss badge', async () => {
    await page.goto('/inward-dcs/new');
    await pick(page, /Job worker/, 'Sri Murugan');
    await page.getByLabel(`Link ${s.knitOutNo}`).check();
    await cell(page, '0:2', '66');
    await page.getByRole('button', { name: /Auto-split/ }).click();
    await expect(page.getByTitle(/Running loss 5\.71%/)).toBeVisible(); // (70 − 66) ÷ 70
    await saveDraft(page);
    await primary(page);
    await expectStatus(page, 'POSTED');
    const api = await apiClient();
    const inw = (await (await api.get(`/api/v1/inward-dcs/${idFromUrl(page)}`)).json()).data;
    s.greigeRoll = inw.lines[0].rollNo;
  });

  test('dyeing: send the greige roll by scanning it, receive dyed rolls', async () => {
    const o = await outward(/Dyeing/, 'Sri Vinayaga', async () => {
      await page.getByPlaceholder('Scan a roll QR / type roll no. + Enter').fill(s.greigeRoll!);
      await page.keyboard.press('Enter');
      await expect(page.getByText(`Roll ${s.greigeRoll} · 66.000 kg added`)).toBeVisible();
    });
    await page.goto('/inward-dcs/new');
    await pick(page, /Job worker/, 'Sri Vinayaga');
    await page.getByLabel(`Link ${o.no}`).check();
    await cell(page, '0:2', '30');
    await cell(page, '0:3', 'DL-E2E');
    await cell(page, '0:4', 'NAVY');
    await page.getByRole('button', { name: 'Add roll' }).click();
    await cell(page, '1:2', '30');
    await page.getByRole('button', { name: /Auto-split/ }).click();
    await saveDraft(page);
    await primary(page);
    await expectStatus(page, 'POSTED');
    const api = await apiClient();
    const inw = (await (await api.get(`/api/v1/inward-dcs/${idFromUrl(page)}`)).json()).data;
    s.dyed1 = inw.lines[0].rollNo;
    s.dyed2 = inw.lines[1].rollNo;
  });

  test('closing the knitting D.C. freezes the final loss', async () => {
    await page.goto(`/outward-dcs/${s.knitOut}`);
    await withReason(page, /^Close$/, 'Close', 'Knitting complete');
    await expectStatus(page, 'CLOSED');
    await expect(page.getByText('Final loss')).toBeVisible();
  });

  test('cutting lay: scan rolls, generate bundles, post', async () => {
    await page.goto('/cut-lays/new');
    await pick(page, 'Order *', orderNo);
    await (await field(page, /^Colour/)).selectOption('NAVY');
    await page.getByLabel('Plies').fill('10');
    await page.getByLabel('Pieces per bundle').fill('10');
    for (const r of [s.dyed1!, s.dyed2!]) {
      await page.getByPlaceholder('Scan roll QR / type roll no. + Enter').fill(r);
      await page.keyboard.press('Enter');
    }
    await page.locator('label').filter({ hasText: /^S$/ }).locator('input').fill('1');
    await page.locator('label').filter({ hasText: /^M$/ }).locator('input').fill('1');
    await page.getByRole('button', { name: 'Generate bundles' }).click();
    await expect(page.getByText('8 bundles · 80 pieces')).toBeVisible();
    await saveDraft(page);
    await primary(page);
    await expectStatus(page, 'POSTED');
    const api = await apiClient();
    const lay = (await (await api.get(`/api/v1/cut-lays/${idFromUrl(page)}`)).json()).data;
    for (const b of lay.bundles) s[`${b.componentCode}-${b.size}-${b.lineNo}`] = b.bundleNo;
    s.layBundles = JSON.stringify(lay.bundles.map((b: { bundleNo: string; componentCode: string; size: string }) => [b.bundleNo, b.componentCode, b.size]));
  });

  const bundles = () => JSON.parse(s.layBundles!) as [string, string, string][];

  test('front panels to the printer and back (1 rejected)', async () => {
    await page.goto('/panel-out/new');
    await (await field(page, /^Process/)).selectOption({ label: 'Printing' });
    await pick(page, 'Vendor *', 'Arun');
    for (const [no] of bundles().filter(([, c]) => c === 'FRONT')) {
      await page.getByPlaceholder('Scan bundle ticket QR + Enter').fill(no);
      await page.keyboard.press('Enter');
    }
    await saveDraft(page);
    await primary(page);
    await expectStatus(page, 'POSTED');
    s.panelOut = idFromUrl(page);
    await page.goto('/panel-in/new');
    await pick(page, 'Vendor *', 'Arun');
    const [frontS, frontM] = bundles()
      .filter(([, c]) => c === 'FRONT')
      .sort((a, b) => a[2].localeCompare(b[2]))
      .reverse(); // S then M
    await page.getByLabel(`Receive ${frontS![0]}`).check();
    await page.getByLabel(`Receive ${frontM![0]}`).check();
    const row = page.getByRole('row', { name: new RegExp(frontS![0].replace(/[/]/g, '\\/')) });
    await row.getByRole('textbox').nth(0).fill('9');
    await row.getByRole('textbox').nth(1).fill('1');
    await saveDraft(page);
    await primary(page);
    await expectStatus(page, 'POSTED');
    await page.goto(`/panel-out/${s.panelOut}`);
    await expect(page.getByText('Debit value (rejected + missing)')).toBeVisible();
  });

  test('sewing issue by scanning bundles, output, carton, packing list', async () => {
    await page.goto('/sewing-issues/new');
    for (const [no] of bundles().filter(([, , size]) => size === 'S')) {
      await page.getByPlaceholder('Scan bundle QR + Enter').fill(no);
      await page.keyboard.press('Enter');
      await expect(page.getByText(no).first()).toBeVisible();
    }
    await saveDraft(page);
    await primary(page);
    await expectStatus(page, 'POSTED');

    await page.goto('/sewing-entries/new');
    await pick(page, 'Order *', orderNo);
    await page.getByLabel('NAVY S', { exact: true }).fill('9');
    await saveDraft(page);
    await primary(page);
    await expectStatus(page, 'POSTED');

    await page.goto('/cartons/new');
    await pick(page, 'Order *', orderNo);
    await page.getByLabel('NAVY S', { exact: true }).fill('9');
    await page.getByLabel('Gross kg').fill('4.5');
    await saveDraft(page);
    await primary(page);
    await expectStatus(page, 'POSTED');

    await page.goto('/packing-lists/new');
    await pick(page, 'Order *', orderNo);
    await page.getByLabel('Select carton 1').check();
    await saveDraft(page);
    await primary(page);
    await expectStatus(page, 'POSTED');
  });

  test('order WIP shows the progress against the PO', async () => {
    await page.goto(`/orders/${s.orderId}`);
    const wip = page.locator('div.rounded-md.border', { hasText: 'Packed' }).first();
    await expect(wip).toContainText('9');
    await expect(page.locator('div.rounded-md.border', { hasText: 'Sewn' }).first()).toContainText('9');
  });
});
