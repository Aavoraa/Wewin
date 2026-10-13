import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * Development / demonstration data only (never run against production; set SEED_DEMO=false).
 * Matches the build-flow seed guidance: 3 knitters, 2 dyers, 1 compactor, 1 printer, 1 embroiderer,
 * 2 buyers, and one order with a 3-colour × 5-size matrix (added by the orders seed).
 * Idempotent: everything is upserted by code.
 */
const DEMO_RATES: Record<string, { unit: 'KG' | 'PCS'; rate: string }> = {
  KNITTING: { unit: 'KG', rate: '18' },
  DYEING: { unit: 'KG', rate: '95' },
  COMPACTING: { unit: 'KG', rate: '9' },
  PRINTING: { unit: 'PCS', rate: '2.5' },
  EMBROIDERY: { unit: 'PCS', rate: '4' },
};

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
      // Demo job-work rate so bill matching can be tried; replace with the agreed contract rates.
      const demo = DEMO_RATES[pc];
      const exists = await prisma.rateContract.findFirst({ where: { vendorId: row.id, processId: proc[pc]!, itemId: null, orderId: null } });
      if (demo && !exists) {
        await prisma.rateContract.create({
          data: { vendorId: row.id, processId: proc[pc]!, unit: demo.unit, rate: new Prisma.Decimal(demo.rate), effectiveFrom: new Date('2026-04-01T00:00:00Z'), remarks: 'Demo rate — replace with the agreed rate' },
        });
      }
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
  await seedDemoOrder(prisma, proc);
}

/** One confirmed order (3 colours × 5 sizes) with costing, an approved fabric program and trims BOM. */
async function seedDemoOrder(prisma: PrismaClient, proc: Record<string, string>) {
  const item = async (code: string) => (await prisma.item.findUniqueOrThrow({ where: { code } })).id;
  const garment = await prisma.item.upsert({
    where: { code: 'GMT-KT101' },
    create: { code: 'GMT-KT101', name: 'Kids crew-neck tee KT-101', type: 'GARMENT', unit: 'PCS', hsnCode: '6109' },
    update: {},
  });
  if (await prisma.order.findUnique({ where: { orderNo: 'WW-2627-001' } })) return;
  const buyer = await prisma.buyer.findUniqueOrThrow({ where: { code: 'BUY-NKA' } });
  const colours = ['NAVY', 'RED', 'WHITE'];
  const sizes = ['2Y', '4Y', '6Y', '8Y', '10Y'];
  const qty: Record<string, number[]> = { NAVY: [300, 400, 400, 300, 200], RED: [200, 300, 300, 200, 100], WHITE: [250, 350, 350, 250, 150] };
  const price = ['2.95', '3.10', '3.25', '3.40', '3.55'];
  const order = await prisma.order.create({
    data: {
      orderNo: 'WW-2627-001',
      buyerId: buyer.id,
      buyerPoNo: 'NKA-PO-45821',
      poDate: new Date('2026-09-15T00:00:00Z'),
      shipDate: new Date('2026-12-20T00:00:00Z'),
      styleNo: 'KT-101',
      styleName: 'Kids crew-neck tee, chest print',
      garmentItemId: garment.id,
      currency: 'EUR',
      colours,
      sizes,
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      lines: {
        create: colours.flatMap((c) => sizes.map((s, i) => ({ colour: c, size: s, qty: qty[c]![i]!, unitPrice: new Prisma.Decimal(price[i]!) }))),
      },
      components: {
        create: [
          { code: 'FRONT', name: 'Front', panelItemId: await item('PNL-FRONT'), pcsPerGarment: 1, sortOrder: 0 },
          { code: 'BACK', name: 'Back', panelItemId: await item('PNL-BACK'), pcsPerGarment: 1, sortOrder: 1 },
          { code: 'SLEEVE', name: 'Sleeve', panelItemId: await item('PNL-SLEEVE'), pcsPerGarment: 2, sortOrder: 2 },
          { code: 'NECKRIB', name: 'Neck rib', panelItemId: await item('PNL-NECKRIB'), pcsPerGarment: 1, sortOrder: 3 },
        ],
      },
      costing: {
        create: {
          panelCostPerPiece: new Prisma.Decimal('7.50'),
          fobPerPiece: new Prisma.Decimal('3.25'),
          exchangeRate: new Prisma.Decimal('92.50'),
          lines: {
            create: [
              { sortOrder: 0, head: 'Fabric (dyed SJ)', basis: 'KG', consumption: new Prisma.Decimal('0.165'), rate: new Prisma.Decimal('430') },
              { sortOrder: 1, head: 'Chest print', basis: 'PC', consumption: new Prisma.Decimal('1'), rate: new Prisma.Decimal('6') },
              { sortOrder: 2, head: 'Stitching', basis: 'PC', consumption: new Prisma.Decimal('1'), rate: new Prisma.Decimal('18') },
              { sortOrder: 3, head: 'Trims & packing', basis: 'PC', consumption: new Prisma.Decimal('1'), rate: new Prisma.Decimal('9') },
            ],
          },
        },
      },
    },
  });
  await prisma.fabricProgram.create({
    data: {
      programNo: 'WW-2627-001/P1',
      orderId: order.id,
      fabricItemId: await item('FAB-DSJ30'),
      colour: 'NAVY',
      requiredKg: new Prisma.Decimal('420'),
      gsm: 160,
      dia: '30" OW',
      status: 'APPROVED',
      approvedAt: new Date(),
      processes: {
        create: [
          { sequence: 1, processId: proc.KNITTING!, inputItemId: await item('YRN-30CC'), outputItemId: await item('FAB-GSJ30'), allowedLossPct: new Prisma.Decimal('2'), materialCostPerKg: new Prisma.Decimal('285') },
          { sequence: 2, processId: proc.DYEING!, inputItemId: await item('FAB-GSJ30'), outputItemId: await item('FAB-DSJ30'), allowedLossPct: new Prisma.Decimal('8'), materialCostPerKg: new Prisma.Decimal('315') },
          { sequence: 3, processId: proc.COMPACTING!, inputItemId: await item('FAB-DSJ30'), outputItemId: await item('FAB-DSJ30'), allowedLossPct: new Prisma.Decimal('1'), materialCostPerKg: new Prisma.Decimal('425') },
        ],
      },
    },
  });
  await prisma.trimsBomLine.createMany({
    data: [
      { orderId: order.id, trimItemId: await item('TRM-MLBL'), qtyPerGarment: new Prisma.Decimal('1'), wastagePct: new Prisma.Decimal('3') },
      { orderId: order.id, trimItemId: await item('TRM-CLBL'), qtyPerGarment: new Prisma.Decimal('1'), wastagePct: new Prisma.Decimal('3') },
      { orderId: order.id, trimItemId: await item('TRM-HTAG'), qtyPerGarment: new Prisma.Decimal('1'), wastagePct: new Prisma.Decimal('2') },
      { orderId: order.id, trimItemId: await item('TRM-POLY'), qtyPerGarment: new Prisma.Decimal('1'), wastagePct: new Prisma.Decimal('2') },
      { orderId: order.id, trimItemId: await item('TRM-CTN5'), qtyPerGarment: new Prisma.Decimal('0.0417'), wastagePct: new Prisma.Decimal('1') },
    ],
  });

}
