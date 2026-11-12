import { expect, test } from '@playwright/test';
import { programmeScreenPdf } from '../../api/test/invoice-fixtures';
import { apiClient, login, uid } from './helpers';

/** Order › Fabric programs tab: upload a Programme Entry screenshot; it is read, shown and saved as draft programmes (Q-068 / Q-070). */
test('upload a programme entry from the order tab → read → Save programme → draft saved', async ({ page }) => {
  await login(page);
  const api = await apiClient();
  const order = ((await (await api.get('/api/v1/orders?q=WW-2627-001')).json()).data as { id: string; orderNo: string }[]).find((o) => o.orderNo === 'WW-2627-001')!;
  await page.goto(`/orders/${order.id}`);
  await page.getByRole('button', { name: 'Fabric programs', exact: true }).click();
  await expect(page.getByText('Programme Entry uploads')).toBeVisible();

  const name = `${uid('neck-rib')}.pdf`;
  await page.getByLabel('Programme Entry screenshot').setInputFiles({ name, mimeType: 'application/pdf', buffer: await programmeScreenPdf('O/0001/WKF/25/ANY', 'NAVY') });
  const card = page.locator('div.rounded.border').filter({ hasText: name });
  await expect(card.getByText('Ready to save')).toBeVisible({ timeout: 30_000 }); // order known: nothing to confirm
  // Minimal by default: one line; the full reading opens on click.
  await expect(card.getByText('Order Ref')).toBeHidden();
  await card.locator('button[aria-expanded]').click();
  await expect(card.getByText('Order Ref')).toBeVisible();
  await card.getByRole('button', { name: 'Save programme' }).click();
  await expect(card.getByText('Saved', { exact: true })).toBeVisible();
  await expect(card.getByText(/draft; to approve, fill in/)).toBeVisible();
  await page.screenshot({ path: 'test-results/programme-upload.png', fullPage: true });

  await card.getByRole('link', { name: /WW-2627-001\/P\d+/ }).first().click();
  await expect(page.getByText(/Draft — to approve, fill in/)).toBeVisible();
  await expect(page.getByLabel('Color / Combo')).toHaveValue('NAVY');
});

/** Fabric programs page: upload without an order; the suggested order is confirmed on the card (Q-068). */
test('upload on the Fabric programs page → confirm the suggested order → Edit before saving', async ({ page }) => {
  await login(page);
  await page.goto('/programs');
  await expect(page.getByText('Programme Entry uploads')).toBeVisible();
  const name = `${uid('body-slv')}.pdf`;
  await page.getByLabel('Programme Entry screenshot').setInputFiles({ name, mimeType: 'application/pdf', buffer: await programmeScreenPdf(`O/0001/WKF/25/KT-101 ${uid('R')}`, 'RED') });
  const card = page.locator('div.rounded.border').filter({ hasText: name });
  await expect(card.getByText('Confirm the order')).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: /Confirm WW-2627-001/ }).click();
  await expect(card.getByText('Ready to save')).toBeVisible();
  await page.screenshot({ path: 'test-results/programme-upload-list.png' });

  // Delete an upload (another file): it disappears from the list.
  const extra = `${uid('delete-me')}.pdf`;
  await page.getByLabel('Programme Entry screenshot').setInputFiles({ name: extra, mimeType: 'application/pdf', buffer: await programmeScreenPdf('O/0001/WKF/25/KT-101 DEL', 'RED') });
  const gone = page.locator('div.rounded.border').filter({ hasText: extra });
  await expect(gone.getByText('Confirm the order')).toBeVisible({ timeout: 30_000 });
  await gone.getByRole('button', { name: `Delete ${extra}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(gone).toHaveCount(0);
  await card.getByRole('link', { name: /Edit before saving/ }).click();
  await expect(page).toHaveURL(/\/programs\/new\?fromScan=/);
  await expect(page.getByLabel('Color / Combo')).toHaveValue('RED');
});
