import { type Prisma, type PrismaClient } from '@prisma/client';

/**
 * Development / demonstration data only (never run against production; set SEED_DEMO=false).
 * Matches the build-flow seed guidance: 3 knitters, 2 dyers, 1 compactor, 1 printer, 1 embroiderer,
 * 2 buyers, and one order with a 3-colour × 5-size matrix (added by the orders seed).
 * Idempotent: everything is upserted by code.
 */
export async function seedDemo(prisma: PrismaClient): Promise<void> {
  const processes = [
    { code: 'KNITTING', name: 'Knitting', stage: 'KG' as const, defaultReturnDays: 15 },
    { code: 'DYEING', name: 'Dyeing', stage: 'KG' as const, defaultReturnDays: 20 },
    { code: 'COMPACTING', name: 'Compacting', stage: 'KG' as const, defaultReturnDays: 7 },
    { code: 'PRINTING', name: 'Printing', stage: 'PCS' as const, defaultReturnDays: 10 },
    { code: 'EMBROIDERY', name: 'Embroidery', stage: 'PCS' as const, defaultReturnDays: 10 },
  ];
  const proc: Record<string, string> = {};
  for (const p of processes) {
    proc[p.code] = (await prisma.process.upsert({ where: { code: p.code }, create: p, update: {} })).id;
  }

  const vendors = [
    { code: 'KNT-SMK', name: 'Sri Murugan Knitting', city: 'Tiruppur', procs: ['KNITTING'], creditDays: 30 },
    { code: 'KNT-AVK', name: 'Annai Velankanni Knits', city: 'Tiruppur', procs: ['KNITTING'], creditDays: 30 },
    { code: 'KNT-KPK', name: 'Kongu Power Knitting', city: 'Avinashi', procs: ['KNITTING'], creditDays: 45 },
    { code: 'DYE-SVD', name: 'Sri Vinayaga Dyeing', city: 'Tiruppur', procs: ['DYEING'], creditDays: 45 },
    { code: 'DYE-NCP', name: 'Noyyal Colour Processors', city: 'Perundurai', procs: ['DYEING'], creditDays: 45 },
    { code: 'CMP-RCF', name: 'Royal Compacting & Finishing', city: 'Tiruppur', procs: ['COMPACTING'], creditDays: 30 },
    { code: 'PRT-ASP', name: 'Arun Screen Printers', city: 'Tiruppur', procs: ['PRINTING'], creditDays: 30 },
    { code: 'EMB-STE', name: 'Star Embroidery Works', city: 'Tiruppur', procs: ['EMBROIDERY'], creditDays: 30 },
    { code: 'MIL-KSM', name: 'Kaveri Spinning Mills', city: 'Coimbatore', procs: [], creditDays: 60 },
    { code: 'TRM-PLA', name: 'Precision Labels & Accessories', city: 'Tiruppur', procs: [], creditDays: 30 },
  ];
  for (const v of vendors) {
    const row = await prisma.vendor.upsert({
      where: { code: v.code },
      create: { code: v.code, name: v.name, city: v.city, state: 'Tamil Nadu', stateCode: '33', creditDays: v.creditDays },
      update: {},
    });
    await prisma.location.upsert({
      where: { vendorId: row.id },
      create: { code: `V-${row.code}`, name: row.name, kind: 'VENDOR', vendorId: row.id },
      update: {},
    });
    for (const pc of v.procs) {
      await prisma.vendorProcess.upsert({
        where: { vendorId_processId: { vendorId: row.id, processId: proc[pc]! } },
        create: { vendorId: row.id, processId: proc[pc]! },
        update: {},
      });
    }
  }

  const buyers = [
    { code: 'BUY-NKA', name: 'Nordic Kids AB', country: 'Sweden', currency: 'EUR', city: 'Stockholm' },
    { code: 'BUY-HBU', name: 'Harbour Basics UK Ltd', country: 'United Kingdom', currency: 'GBP', city: 'Manchester' },
  ];
  for (const b of buyers) await prisma.buyer.upsert({ where: { code: b.code }, create: b, update: {} });

  const items: Prisma.ItemCreateInput[] = [
    { code: 'YRN-30CC', name: '30s Combed Cotton Yarn', type: 'YARN', unit: 'KG', hsnCode: '5205', spec: '30/1 Ne, 100% combed cotton' },
    { code: 'YRN-40CC', name: '40s Combed Cotton Yarn', type: 'YARN', unit: 'KG', hsnCode: '5205', spec: '40/1 Ne, 100% combed cotton' },
    { code: 'YRN-20LY', name: '20D Lycra', type: 'YARN', unit: 'KG', hsnCode: '5402', spec: '20 denier spandex' },
    { code: 'FAB-GSJ30', name: 'Greige Single Jersey 30s', type: 'FABRIC', unit: 'KG', hsnCode: '6006', spec: 'Single jersey, 30s, open width', gsm: 160 },
    { code: 'FAB-DSJ30', name: 'Dyed Single Jersey 30s', type: 'FABRIC', unit: 'KG', hsnCode: '6006', spec: 'Dyed single jersey, 30s', gsm: 160 },
    { code: 'FAB-GRB40', name: 'Greige 1x1 Rib 40s Lycra', type: 'FABRIC', unit: 'KG', hsnCode: '6006', spec: '1x1 rib with lycra', gsm: 220 },
    { code: 'FAB-DRB40', name: 'Dyed 1x1 Rib 40s Lycra', type: 'FABRIC', unit: 'KG', hsnCode: '6006', spec: 'Dyed 1x1 rib with lycra', gsm: 220 },
    { code: 'PNL-FRONT', name: 'Front panel', type: 'PANEL', unit: 'PCS', hsnCode: '6117' },
    { code: 'PNL-BACK', name: 'Back panel', type: 'PANEL', unit: 'PCS', hsnCode: '6117' },
    { code: 'PNL-SLEEVE', name: 'Sleeve panel', type: 'PANEL', unit: 'PCS', hsnCode: '6117' },
    { code: 'PNL-NECKRIB', name: 'Neck rib', type: 'PANEL', unit: 'PCS', hsnCode: '6117' },
    { code: 'TRM-MLBL', name: 'Main woven label', type: 'TRIM', unit: 'NOS', hsnCode: '5807' },
    { code: 'TRM-CLBL', name: 'Care label', type: 'TRIM', unit: 'NOS', hsnCode: '5807' },
    { code: 'TRM-HTAG', name: 'Hang tag', type: 'TRIM', unit: 'NOS', hsnCode: '4821' },
    { code: 'TRM-POLY', name: 'Polybag 10x14', type: 'TRIM', unit: 'NOS', hsnCode: '3923' },
    { code: 'TRM-CTN5', name: 'Export carton 5-ply', type: 'TRIM', unit: 'NOS', hsnCode: '4819' },
    { code: 'TRM-THRD', name: 'Sewing thread 40/2 cone', type: 'TRIM', unit: 'NOS', hsnCode: '5204' },
  ];
  for (const i of items) await prisma.item.upsert({ where: { code: i.code }, create: i, update: {} });

}
