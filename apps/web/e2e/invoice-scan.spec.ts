import { expect, test } from '@playwright/test';
import { invoicePdf, yarnInvoice } from '../../api/test/invoice-fixtures';
import { login, uid } from './helpers';

/**
 * Invoice scanning through the UI: upload a synthetic invoice from the demo mill, review the
 * extracted values next to the document, confirm the vendor, create the draft yarn receipt.
 */
test.describe.serial('invoice scanning', () => {
  test('upload → review → draft yarn receipt (nothing posted)', async ({ page }) => {
    await login(page);
    await page.goto('/scans');
    const invoiceNo = uid('KSM/26-27/');
    const pdf = await invoicePdf(
      yarnInvoice({
        vendorName: 'KAVERI SPINNING MILLS (SAMPLE)',
        invoiceNo,
        invoiceDate: '14-10-2026',
        lines: [
          { desc: '30s Combed Cotton Yarn Lot No: E2E-2291', hsn: '5205', qty: '1,200.000', unit: 'Kgs', rate: '284.00' },
          { desc: '40s Combed Cotton Yarn Lot No: E2E-2292', hsn: '5205', qty: '600.000', unit: 'Kgs', rate: '309.50' },
        ],
      }),
    );
    await page.locator('input[type=file]').setInputFiles({ name: 'kaveri-invoice.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page).toHaveURL(/\/scans\/[0-9a-f-]{36}$/);
    // Background extraction finishes and the review screen fills in.
    await expect(page.getByLabel('Invoice no. *')).toHaveValue(invoiceNo, { timeout: 30_000 });
    await expect(page.getByText('Lines · 2 read')).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible(); // the original document
    // Vendor has no GSTIN in the demo master: suggested by name, the reviewer confirms.
    await page.getByRole('button', { name: /Kaveri Spinning Mills/ }).click();
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(page.getByText('All checks passed')).toBeVisible();
    await page.getByRole('button', { name: /Create draft yarn receipt/ }).click();
    await expect(page).toHaveURL(/\/yarn-receipts\/[0-9a-f-]{36}$/);
    await expect(page.getByText('DRAFT', { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel('Supplier invoice no.')).toHaveValue(invoiceNo);
    await expect(page.getByText('1,800.000 kg')).toBeVisible();
  });
});
