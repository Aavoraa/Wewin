/**
 * Writes SAMPLE invoices (synthetic, for trying invoice scanning with the demo data) to
 * <STORAGE_DIR>/samples: a searchable PDF, a scanned PDF and a phone photo of a yarn invoice from
 * the demo mill, and a trims invoice. These are not real documents.
 *
 *   pnpm --filter @wewin/api exec tsx --env-file=../../.env scripts/make-sample-invoices.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gstin, invoiceImages, invoicePdf, scannedPdf, yarnInvoice } from '../test/invoice-fixtures';

const dir = path.resolve(process.env.STORAGE_DIR ?? './storage', 'samples');
await mkdir(dir, { recursive: true });

const yarn = yarnInvoice({
  vendorName: 'KAVERI SPINNING MILLS (SAMPLE)',
  vendorAddress: 'Avinashi Road, Coimbatore 641018, Tamil Nadu',
  vendorGstin: gstin('33', 'AAKCK5521P'),
  buyerGstin: gstin('33', 'AABFW9876Q'),
  invoiceNo: 'KSM/26-27/0412',
  invoiceDate: '14-10-2026',
  lines: [
    { desc: '30s Combed Cotton Yarn Lot No: KSM-2291', hsn: '5205', qty: '1,200.000', unit: 'Kgs', rate: '284.00' },
    { desc: '40s Combed Cotton Yarn Lot No: KSM-2292', desc2: '(Hosiery, 24 bags)', hsn: '5205', qty: '600.000', unit: 'Kgs', rate: '309.50' },
  ],
});
await writeFile(path.join(dir, 'sample-yarn-invoice.pdf'), await invoicePdf(yarn));
await writeFile(path.join(dir, 'sample-yarn-invoice-scanned.pdf'), await scannedPdf(yarn));
await writeFile(path.join(dir, 'sample-yarn-invoice-photo.png'), invoiceImages(yarn, 2, 1.2)[0]!);

const trims = yarnInvoice({
  vendorName: 'PRECISION LABELS & ACCESSORIES (SAMPLE)',
  vendorAddress: 'Kumar Nagar, Tiruppur 641603, Tamil Nadu',
  vendorGstin: gstin('33', 'AAGFP7712L'),
  buyerGstin: gstin('33', 'AABFW9876Q'),
  invoiceNo: 'PLA/2026/1786',
  invoiceDate: '15-10-2026',
  taxRatePct: '12',
  lines: [
    { desc: 'Main woven label (Wewin)', hsn: '5807', qty: '5,000', unit: 'Nos', rate: '0.85' },
    { desc: 'Polybag 10x14 with warning print', hsn: '3923', qty: '4,000', unit: 'Nos', rate: '1.20' },
    { desc: 'Hang tag', hsn: '4821', qty: '4,000', unit: 'Nos', rate: '0.65' },
  ],
});
await writeFile(path.join(dir, 'sample-trims-invoice.pdf'), await invoicePdf(trims));
console.log(`Sample invoices written to ${dir}`);
