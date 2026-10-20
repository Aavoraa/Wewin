/**
 * Writes SAMPLE invoices (synthetic, for trying invoice scanning with the demo data) to
 * <STORAGE_DIR>/samples: a searchable PDF, a scanned PDF and a phone photo of a yarn invoice from
 * the demo mill, a trims invoice, and two job-work delivery challans (our outward D.C. on paper, and
 * the knitter's return D.C. against YDC/26-27/0001). These are not real documents.
 *
 *   pnpm --filter @wewin/api exec tsx --env-file=../../.env scripts/make-sample-invoices.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buyerPoPdf, dcPdf, gstin, invoiceImages, invoicePdf, scannedPdf, yarnInvoice } from '../test/invoice-fixtures';

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
// Delivery challans: Wewin's paper outward D.C. to the knitter, and the knitter's return D.C.
await writeFile(
  path.join(dir, 'sample-outward-dc.pdf'),
  await dcPdf({
    issuerName: 'WEWIN KNIT FASHIONS',
    issuerGstin: gstin('33', 'AABFW9876Q'),
    consigneeName: 'ANNAI VELANKANNI KNITS (SAMPLE)',
    consigneeGstin: gstin('33', 'AANFA4410K'),
    dcNo: 'P-0107',
    dcDate: '19-10-2026',
    lines: [{ desc: '30s Combed Cotton Yarn', lot: 'KSM-L4471', rolls: '60', kg: '1,200.000', rate: '285.00' }],
  }),
);
await writeFile(
  path.join(dir, 'sample-inward-dc.pdf'),
  await dcPdf({
    issuerName: 'ANNAI VELANKANNI KNITS',
    issuerGstin: gstin('33', 'AANFA4410K'),
    consigneeName: 'WEWIN KNIT FASHIONS',
    consigneeGstin: gstin('33', 'AABFW9876Q'),
    dcNo: 'AVK/552',
    dcDate: '24-10-2026',
    yourDcNo: 'YDC/26-27/0001',
    lines: [
      { desc: '30s Single Jersey Greige', lot: 'KSM-L4471', colour: 'GREY', rollNo: 'AVK-552-1', kg: '392.500' },
      { desc: '30s Single Jersey Greige', lot: 'KSM-L4471', colour: 'GREY', rollNo: 'AVK-552-2', kg: '398.000' },
      { desc: '30s Single Jersey Greige', lot: 'KSM-L4471', colour: 'GREY', rollNo: 'AVK-552-3', kg: '385.250' },
    ],
  }),
);
// Buyer purchase order with a colour × size grid (Orders › Upload buyer PO).
await writeFile(
  path.join(dir, 'sample-buyer-po.pdf'),
  await buyerPoPdf({
    buyerName: 'NORDIC KIDS AB',
    poNo: 'NKA-PO-46017',
    poDate: '18-10-2026',
    shipDate: '15-01-2027',
    styleNo: 'KT-204',
    styleName: 'Kids long-sleeve tee',
    sizes: ['2Y', '4Y', '6Y', '8Y', '10Y'],
    rows: [
      { colour: 'NAVY', qty: ['200', '300', '300', '250', '150'], price: '3.80' },
      { colour: 'HEATHER GREY', qty: ['150', '250', '250', '200', '100'], price: '3.80' },
      { colour: 'RED', qty: ['100', '150', '150', '', ''], price: '3.95' },
    ],
  }),
);
console.log(`Sample invoices, D.C.s and buyer PO written to ${dir}`);
