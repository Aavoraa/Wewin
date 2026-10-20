import { Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const outwardInclude = {
  vendor: { select: { id: true, code: true, name: true, gstin: true, addressLine1: true, addressLine2: true, city: true, state: true, stateCode: true, pincode: true } },
  process: { select: { id: true, code: true, name: true, defaultReturnDays: true } },
  order: { select: { id: true, orderNo: true, styleNo: true, status: true } },
  fromLocation: { select: { id: true, code: true, name: true, kind: true, vendorId: true } },
  approvedBy: { select: { id: true, fullName: true } },
  programProcess: {
    select: { id: true, sequence: true, allowedLossPct: true, materialCostPerKg: true, inputItemId: true, outputItemId: true, program: { select: { id: true, programNo: true } } },
  },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: { item: { select: { id: true, code: true, name: true, hsnCode: true, type: true } }, roll: { select: { id: true, rollNo: true } } },
  },
} satisfies Prisma.OutwardDcInclude;
export type OutwardDetail = Prisma.OutwardDcGetPayload<{ include: typeof outwardInclude }>;

const inwardInclude = {
  vendor: { select: { id: true, code: true, name: true, gstin: true } },
  toLocation: { select: { id: true, code: true, name: true, kind: true } },
  lines: { orderBy: { lineNo: 'asc' }, include: { item: { select: { id: true, code: true, name: true, hsnCode: true } }, roll: { select: { id: true, rollNo: true } } } },
  links: {
    include: {
      outward: {
        select: {
          id: true,
          docNo: true,
          docDate: true,
          status: true,
          orderId: true,
          vendorId: true,
          processId: true,
          allowedLossPct: true,
          process: { select: { code: true, name: true } },
          programProcess: { select: { outputItemId: true, allowedLossPct: true } },
        },
      },
    },
  },
} satisfies Prisma.InwardDcInclude;
export type InwardDetail = Prisma.InwardDcGetPayload<{ include: typeof inwardInclude }>;

export interface OutwardLineData {
  itemId: string;
  lot: string;
  colour: string;
  rollId: string | null;
  qtyKg: string;
  rolls: number | null;
  valuePerKg: string | null;
}
export interface InwardLineData {
  itemId: string;
  rollNo: string | null;
  kg: string;
  lot: string;
  colour: string;
  gsm: number | null;
  dia: string | null;
  remarks: string | null;
}

const dec = (v: string | null) => (v === null ? null : new Prisma.Decimal(v));
const outRows = (lines: OutwardLineData[]) =>
  lines.map((l, i) => ({ lineNo: i + 1, itemId: l.itemId, lot: l.lot, colour: l.colour, rollId: l.rollId, qtyKg: new Prisma.Decimal(l.qtyKg), rolls: l.rolls, valuePerKg: dec(l.valuePerKg) }));
const inRows = (lines: InwardLineData[]) =>
  lines.map((l, i) => ({
    lineNo: i + 1,
    itemId: l.itemId,
    rollNo: l.rollNo ?? `#${i + 1}`,
    kg: new Prisma.Decimal(l.kg),
    lot: l.lot,
    colour: l.colour,
    gsm: l.gsm,
    dia: l.dia,
    remarks: l.remarks,
  }));

export const jobworkRepo = {
  // ───────── Outward ─────────
  listOutward(where: Prisma.OutwardDcWhereInput, order: Prisma.OutwardDcOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.outwardDc.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include: outwardInclude }),
      prisma.outwardDc.count({ where }),
    ]);
  },
  getOutward(id: string, db: Db = prisma) {
    return db.outwardDc.findUnique({ where: { id }, include: outwardInclude });
  },
  async lockOutward(tx: Tx, ids: string[]) {
    if (!ids.length) return;
    // Sorted lock order avoids deadlocks between concurrent inward postings.
    await tx.$queryRaw`SELECT 1 FROM outward_dcs WHERE id = ANY(${[...ids].sort()}::uuid[]) ORDER BY id FOR UPDATE`;
  },
  createOutward(tx: Tx, data: Omit<Prisma.OutwardDcUncheckedCreateInput, 'lines'>, lines: OutwardLineData[]) {
    return tx.outwardDc.create({ data: { ...data, lines: { create: outRows(lines) } } });
  },
  async updateOutward(tx: Tx, id: string, version: number, data: Prisma.OutwardDcUncheckedUpdateManyInput, lines: OutwardLineData[]) {
    const r = await tx.outwardDc.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.outwardDcLine.deleteMany({ where: { dcId: id } });
    await tx.outwardDcLine.createMany({ data: outRows(lines).map((l) => ({ ...l, dcId: id })) });
    return true;
  },
  deleteOutward(tx: Tx, id: string) {
    return tx.outwardDc.delete({ where: { id } });
  },
  updateOutwardState(tx: Tx, id: string, data: Prisma.OutwardDcUncheckedUpdateInput) {
    return tx.outwardDc.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },

  /** Kg received against outwards (posted inwards only). */
  async receivedByOutward(ids: string[], db: Db = prisma): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await db.dcLink.groupBy({
      by: ['outwardDcId'],
      where: { outwardDcId: { in: ids }, inward: { status: 'POSTED' } },
      _sum: { receivedKg: true },
    });
    return new Map(rows.map((r) => [r.outwardDcId, (r._sum.receivedKg ?? new Prisma.Decimal(0)).toFixed(3)]));
  },
  /** Kg consumed per outward line (posted inwards only). */
  async consumedByLine(outwardIds: string[], db: Db = prisma): Promise<Map<string, string>> {
    if (!outwardIds.length) return new Map();
    const rows = await db.dcConsumption.groupBy({
      by: ['outwardLineId'],
      where: { outwardLine: { dcId: { in: outwardIds } }, link: { inward: { status: 'POSTED' } } },
      _sum: { kg: true },
    });
    return new Map(rows.map((r) => [r.outwardLineId, (r._sum.kg ?? new Prisma.Decimal(0)).toFixed(3)]));
  },
  postedInwardLinkCount(outwardId: string, db: Db = prisma) {
    return db.dcLink.count({ where: { outwardDcId: outwardId, inward: { status: 'POSTED' } } });
  },
  outwardCountForProgram(programId: string, db: Db = prisma) {
    return db.outwardDc.count({ where: { programProcess: { programId }, status: { not: 'CANCELLED' } } });
  },
  linkedInwards(outwardId: string, db: Db = prisma) {
    return db.dcLink.findMany({
      where: { outwardDcId: outwardId },
      include: { inward: { select: { id: true, docNo: true, docDate: true, status: true, billId: true } } },
      orderBy: { inward: { docDate: 'asc' } },
    });
  },

  // ───────── Inward ─────────
  listInward(where: Prisma.InwardDcWhereInput, order: Prisma.InwardDcOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.inwardDc.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include: inwardInclude }),
      prisma.inwardDc.count({ where }),
    ]);
  },
  getInward(id: string, db: Db = prisma) {
    return db.inwardDc.findUnique({ where: { id }, include: inwardInclude });
  },
  async lockInward(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM inward_dcs WHERE id = ${id}::uuid FOR UPDATE`;
  },
  createInward(
    tx: Tx,
    data: Omit<Prisma.InwardDcUncheckedCreateInput, 'lines' | 'links'>,
    lines: InwardLineData[],
    links: { outwardDcId: string; receivedKg: string }[],
  ) {
    return tx.inwardDc.create({
      data: {
        ...data,
        lines: { create: inRows(lines) },
        links: { create: links.map((l) => ({ outwardDcId: l.outwardDcId, receivedKg: new Prisma.Decimal(l.receivedKg) })) },
      },
    });
  },
  async updateInward(
    tx: Tx,
    id: string,
    version: number,
    data: Prisma.InwardDcUncheckedUpdateManyInput,
    lines: InwardLineData[],
    links: { outwardDcId: string; receivedKg: string }[],
  ) {
    const r = await tx.inwardDc.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.inwardDcLine.deleteMany({ where: { dcId: id } });
    await tx.dcLink.deleteMany({ where: { inwardDcId: id } });
    await tx.inwardDcLine.createMany({ data: inRows(lines).map((l) => ({ ...l, dcId: id })) });
    await tx.dcLink.createMany({ data: links.map((l) => ({ inwardDcId: id, outwardDcId: l.outwardDcId, receivedKg: new Prisma.Decimal(l.receivedKg) })) });
    return true;
  },
  deleteInward(tx: Tx, id: string) {
    return tx.inwardDc.delete({ where: { id } });
  },
  updateInwardState(tx: Tx, id: string, data: Prisma.InwardDcUncheckedUpdateInput) {
    return tx.inwardDc.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  renameRoll(tx: Tx, lineId: string, rollNo: string) {
    return tx.inwardDcLine.update({ where: { id: lineId }, data: { rollNo } });
  },
  createRoll(tx: Tx, data: Prisma.FabricRollUncheckedCreateInput) {
    return tx.fabricRoll.create({ data });
  },
  rollNoTaken(tx: Tx, rollNos: string[]) {
    return tx.fabricRoll.findMany({ where: { rollNo: { in: rollNos } }, select: { rollNo: true } });
  },
  createConsumptions(tx: Tx, rows: { linkId: string; outwardLineId: string; kg: string }[]) {
    return tx.dcConsumption.createMany({ data: rows.map((r) => ({ ...r, kg: new Prisma.Decimal(r.kg) })) });
  },
  outwardLines(tx: Tx, outwardIds: string[]) {
    return tx.outwardDcLine.findMany({ where: { dcId: { in: outwardIds } }, orderBy: [{ dcId: 'asc' }, { lineNo: 'asc' }] });
  },
  rollsByIds(ids: string[], db: Db = prisma) {
    return db.fabricRoll.findMany({ where: { id: { in: ids } } });
  },
  findRoll(rollNo: string) {
    return prisma.fabricRoll.findUnique({ where: { rollNo }, include: { item: { select: { code: true, name: true } } } });
  },

  // ───────── Billing (accounts) ─────────
  billableInwards(vendorId: string, orderId: string | null, db: Db = prisma) {
    return db.inwardDc.findMany({
      where: {
        vendorId,
        status: 'POSTED',
        billId: null,
        ...(orderId ? { links: { some: { outward: { orderId } } } } : {}),
      },
      orderBy: { docDate: 'asc' },
      include: {
        lines: { select: { kg: true, itemId: true } },
        links: { include: { outward: { select: { id: true, docNo: true, orderId: true, processId: true, process: { select: { name: true } } } } } },
      },
    });
  },
  inwardsByIds(ids: string[], db: Db = prisma) {
    return db.inwardDc.findMany({
      where: { id: { in: ids } },
      include: {
        lines: { select: { kg: true, itemId: true } },
        links: { include: { outward: { select: { id: true, docNo: true, orderId: true, processId: true, status: true, process: { select: { name: true } } } } } },
      },
    });
  },
  async lockInwards(tx: Tx, ids: string[]) {
    if (!ids.length) return;
    await tx.$queryRaw`SELECT 1 FROM inward_dcs WHERE id = ANY(${[...new Set(ids)].sort()}::uuid[]) ORDER BY id FOR UPDATE`;
  },
  setBill(tx: Tx, ids: string[], billId: string) {
    return tx.inwardDc.updateMany({ where: { id: { in: ids }, billId: null, status: 'POSTED' }, data: { billId } });
  },
  clearBill(tx: Tx, billId: string) {
    return tx.inwardDc.updateMany({ where: { billId }, data: { billId: null } });
  },
  /** Closed outwards linked to the given inwards, with what is needed to value excess loss. */
  closedOutwardsOf(tx: Tx, inwardIds: string[]) {
    return tx.outwardDc.findMany({
      where: { status: 'CLOSED', links: { some: { inwardDcId: { in: inwardIds } } } },
      include: {
        vendor: { select: { name: true } },
        process: { select: { name: true } },
        programProcess: { select: { materialCostPerKg: true, inputItemId: true } },
      },
    });
  },
  /** Latest bill among inwards linked to an outward (for debits raised when the outward closes). */
  billedInwardOf(tx: Tx, outwardId: string) {
    return tx.inwardDc.findFirst({
      where: { billId: { not: null }, links: { some: { outwardDcId: outwardId } } },
      orderBy: { docDate: 'desc' },
      select: { billId: true },
    });
  },

  // ───────── Lookups ─────────
  itemsByIds(ids: string[], db: Db = prisma) {
    return db.item.findMany({ where: { id: { in: ids } }, select: { id: true, type: true, isActive: true, code: true, unit: true } });
  },
  vendorHasProcess(vendorId: string, processId: string, db: Db = prisma) {
    return db.vendorProcess.count({ where: { vendorId, processId } });
  },

  // ───────── Scanned D.C.s ─────────
  outwardBySourceScan(sourceScanId: string) {
    return prisma.outwardDc.findUnique({ where: { sourceScanId }, select: { id: true, docNo: true, status: true } });
  },
  inwardBySourceScan(sourceScanId: string) {
    return prisma.inwardDc.findUnique({ where: { sourceScanId }, select: { id: true, docNo: true, status: true } });
  },
  /** The vendor's own D.C. number already entered (cancelled ones excluded). */
  inwardsByVendorDc(vendorId: string, vendorDcNo: string) {
    return prisma.inwardDc.findMany({
      where: { vendorId, vendorDcNo: { equals: vendorDcNo, mode: 'insensitive' }, status: { not: 'CANCELLED' } },
      select: { id: true, docNo: true, status: true, sourceScanId: true },
    });
  },
  /** Approved program processes of open orders that this vendor is set up for. */
  programProcessesForVendor(vendorId: string) {
    return prisma.fabricProgramProcess.findMany({
      where: { program: { status: 'APPROVED', order: { status: { in: ['DRAFT', 'CONFIRMED'] } } }, process: { vendors: { some: { vendorId } } } },
      select: {
        id: true,
        sequence: true,
        plannedVendorId: true,
        allowedLossPct: true,
        inputItemId: true,
        process: { select: { name: true } },
        inputItem: { select: { name: true } },
        program: { select: { programNo: true, order: { select: { orderNo: true, styleNo: true } } } },
      },
      orderBy: [{ program: { programNo: 'asc' } }, { sequence: 'asc' }],
    });
  },

  // ───────── GST job-work reporting (ITC-04) ─────────
  gstSent(from: Date, to: Date) {
    return prisma.outwardDc.findMany({
      where: { status: { in: ['POSTED', 'CLOSED'] }, docDate: { gte: from, lte: to } },
      orderBy: [{ docDate: 'asc' }, { docNo: 'asc' }],
      select: {
        docNo: true,
        docDate: true,
        vendor: { select: { name: true, gstin: true, state: true, stateCode: true } },
        process: { select: { name: true } },
        lines: { orderBy: { lineNo: 'asc' }, select: { qtyKg: true, valuePerKg: true, item: { select: { name: true, hsnCode: true, type: true } } } },
      },
    });
  },
  gstReceived(from: Date, to: Date) {
    return prisma.dcLink.findMany({
      where: { inward: { status: 'POSTED', docDate: { gte: from, lte: to } } },
      orderBy: { inward: { docDate: 'asc' } },
      select: {
        receivedKg: true,
        inward: { select: { docNo: true, docDate: true, vendorDcNo: true, vendorDcDate: true, vendor: { select: { name: true, gstin: true, state: true } } } },
        outward: { select: { docNo: true, docDate: true, process: { select: { name: true } } } },
      },
    });
  },
  gstClosed(from: Date, to: Date) {
    return prisma.outwardDc.findMany({
      // from/to are IST calendar days stored as UTC midnight; shift by IST offset (+05:30) for the timestamp window.
      where: { status: 'CLOSED', closedAt: { gte: new Date(from.getTime() - 19_800_000), lt: new Date(to.getTime() + 86_400_000 - 19_800_000) } },
      orderBy: { closedAt: 'asc' },
      select: { docNo: true, docDate: true, closedAt: true, finalLossKg: true, vendor: { select: { name: true, gstin: true, state: true } }, process: { select: { name: true } } },
    });
  },
};
