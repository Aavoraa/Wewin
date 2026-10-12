import { type Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const include = {
  vendor: { select: { id: true, code: true, name: true, gstin: true, addressLine1: true, city: true, state: true, stateCode: true } },
  process: { select: { id: true, code: true, name: true, defaultReturnDays: true } },
  order: { select: { id: true, orderNo: true, styleNo: true, status: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      bundle: { select: { id: true, bundleNo: true, componentCode: true } },
      panelItem: { select: { id: true, code: true, name: true, hsnCode: true } },
      outLine: { select: { id: true, pcs: true, dcId: true, dc: { select: { docNo: true } } } },
    },
  },
} satisfies Prisma.PanelDcInclude;
export type PanelDcDetail = Prisma.PanelDcGetPayload<{ include: typeof include }>;

export interface PanelLineData {
  bundleId: string;
  panelItemId: string;
  colour: string;
  size: string;
  pcs: number;
  outLineId: string | null;
  goodPcs: number;
  rejectedPcs: number;
}

const rows = (lines: PanelLineData[]) => lines.map((l, i) => ({ lineNo: i + 1, ...l }));

export const panelsRepo = {
  list(where: Prisma.PanelDcWhereInput, order: Prisma.PanelDcOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.panelDc.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include }),
      prisma.panelDc.count({ where }),
    ]);
  },
  get(id: string, db: Db = prisma) {
    return db.panelDc.findUnique({ where: { id }, include });
  },
  async lock(tx: Tx, ids: string[]) {
    if (!ids.length) return;
    await tx.$queryRaw`SELECT 1 FROM panel_dcs WHERE id = ANY(${[...new Set(ids)].sort()}::uuid[]) ORDER BY id FOR UPDATE`;
  },
  create(tx: Tx, data: Omit<Prisma.PanelDcUncheckedCreateInput, 'lines'>, lines: PanelLineData[]) {
    return tx.panelDc.create({ data: { ...data, lines: { create: rows(lines) } } });
  },
  async update(tx: Tx, id: string, version: number, data: Prisma.PanelDcUncheckedUpdateManyInput, lines: PanelLineData[]) {
    const r = await tx.panelDc.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.panelDcLine.deleteMany({ where: { dcId: id } });
    await tx.panelDcLine.createMany({ data: rows(lines).map((l) => ({ ...l, dcId: id })) });
    return true;
  },
  delete(tx: Tx, id: string) {
    return tx.panelDc.delete({ where: { id } });
  },
  setState(tx: Tx, id: string, data: Prisma.PanelDcUncheckedUpdateInput) {
    return tx.panelDc.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  /** OUT lines with their parent D.C. (for IN validation). */
  outLines(ids: string[], db: Db = prisma) {
    return db.panelDcLine.findMany({
      where: { id: { in: ids } },
      include: { dc: { select: { id: true, type: true, status: true, vendorId: true, orderId: true, processId: true, docNo: true } }, bundle: { select: { bundleNo: true } } },
    });
  },
  /** Pieces already returned (good + rejected) against OUT lines by POSTED IN documents. */
  async returnedByOutLine(ids: string[], db: Db = prisma, excludeDcId?: string) {
    if (!ids.length) return new Map<string, { good: number; rejected: number }>();
    const rows = await db.panelDcLine.groupBy({
      by: ['outLineId'],
      where: { outLineId: { in: ids }, dc: { status: 'POSTED', type: 'IN', ...(excludeDcId ? { id: { not: excludeDcId } } : {}) } },
      _sum: { goodPcs: true, rejectedPcs: true },
    });
    return new Map(rows.map((r) => [r.outLineId!, { good: r._sum.goodPcs ?? 0, rejected: r._sum.rejectedPcs ?? 0 }]));
  },
  postedInCountForOut(outDcId: string, db: Db = prisma) {
    return db.panelDcLine.count({ where: { outLine: { dcId: outDcId }, dc: { status: 'POSTED', type: 'IN' } } });
  },
  inDocsForOut(outDcId: string, db: Db = prisma) {
    return db.panelDc.findMany({
      where: { type: 'IN', lines: { some: { outLine: { dcId: outDcId } } } },
      select: { id: true, docNo: true, docDate: true, status: true, billId: true },
    });
  },
  vendorHasProcess(vendorId: string, processId: string, db: Db = prisma) {
    return db.vendorProcess.count({ where: { vendorId, processId } });
  },
  processById(id: string, db: Db = prisma) {
    return db.process.findUnique({ where: { id } });
  },

  // ── Recut slips ──
  listRecut(where: Prisma.RecutSlipWhereInput, p: Paging) {
    return prisma.$transaction([
      prisma.recutSlip.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        include: { order: { select: { orderNo: true, styleNo: true } }, lines: { orderBy: { lineNo: 'asc' }, include: { panelItem: { select: { name: true } } } } },
      }),
      prisma.recutSlip.count({ where }),
    ]);
  },
  getRecut(id: string, db: Db = prisma) {
    return db.recutSlip.findUnique({
      where: { id },
      include: { order: { select: { orderNo: true, styleNo: true } }, lines: { orderBy: { lineNo: 'asc' }, include: { panelItem: { select: { name: true } } } } },
    });
  },
  createRecut(tx: Tx, data: Omit<Prisma.RecutSlipUncheckedCreateInput, 'lines'>, lines: { componentCode: string; panelItemId: string; colour: string; size: string; pcs: number }[]) {
    return tx.recutSlip.create({ data: { ...data, lines: { create: lines.map((l, i) => ({ lineNo: i + 1, ...l })) } } });
  },
  async updateRecut(tx: Tx, id: string, version: number, data: Prisma.RecutSlipUncheckedUpdateManyInput, lines: { componentCode: string; panelItemId: string; colour: string; size: string; pcs: number }[]) {
    const r = await tx.recutSlip.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.recutSlipLine.deleteMany({ where: { slipId: id } });
    await tx.recutSlipLine.createMany({ data: lines.map((l, i) => ({ slipId: id, lineNo: i + 1, ...l })) });
    return true;
  },
  setRecutState(tx: Tx, id: string, data: Prisma.RecutSlipUncheckedUpdateInput) {
    return tx.recutSlip.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  deleteRecut(tx: Tx, id: string) {
    return tx.recutSlip.delete({ where: { id } });
  },
};
