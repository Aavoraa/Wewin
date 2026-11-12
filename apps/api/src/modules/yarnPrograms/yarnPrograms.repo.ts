import { Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const include = {
  order: { select: { id: true, orderNo: true, styleNo: true, status: true } },
  process: { select: { id: true, code: true, name: true } },
  outputItem: { select: { id: true, code: true, name: true } },
  inputs: { orderBy: { lineNo: 'asc' }, include: { item: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.YarnProgramInclude;
export type YarnProgramDetail = Prisma.YarnProgramGetPayload<{ include: typeof include }>;

export interface YarnProgramData {
  outputItemId: string;
  outputColour: string | null;
  requiredKg: string | null;
  allowedLossPct: string;
  materialCostPerKg: string | null;
  remarks: string | null;
}
export interface YarnInputData {
  itemId: string;
  colour: string | null;
  mixPct: string;
}

const dec = (v: string | null) => (v === null ? null : new Prisma.Decimal(v));
const data = (d: YarnProgramData) => ({
  outputItemId: d.outputItemId,
  outputColour: d.outputColour,
  requiredKg: dec(d.requiredKg),
  allowedLossPct: new Prisma.Decimal(d.allowedLossPct),
  materialCostPerKg: dec(d.materialCostPerKg),
  remarks: d.remarks,
});
const inputRows = (inputs: YarnInputData[]) => inputs.map((l, n) => ({ lineNo: n + 1, itemId: l.itemId, colour: l.colour, mixPct: new Prisma.Decimal(l.mixPct) }));

export const yarnProgramsRepo = {
  list(where: Prisma.YarnProgramWhereInput, order: Prisma.YarnProgramOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.yarnProgram.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include }),
      prisma.yarnProgram.count({ where }),
    ]);
  },
  get(id: string, db: Db = prisma) {
    return db.yarnProgram.findUnique({ where: { id }, include });
  },
  async getForUpdate(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM yarn_programs WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.yarnProgram.findUnique({ where: { id }, include });
  },
  /** Programme numbers are per order: <order no>/Y<n> (cancelled ones keep theirs). */
  countForOrder(tx: Tx, orderId: string) {
    return tx.yarnProgram.count({ where: { orderId } });
  },
  create(tx: Tx, head: YarnProgramData & { programNo: string; orderId: string; processId: string }, inputs: YarnInputData[]) {
    return tx.yarnProgram.create({
      data: { ...data(head), programNo: head.programNo, orderId: head.orderId, processId: head.processId, inputs: { create: inputRows(inputs) } },
    });
  },
  async update(tx: Tx, id: string, version: number, head: YarnProgramData, inputs: YarnInputData[]) {
    const r = await tx.yarnProgram.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data(head), version: { increment: 1 } } });
    if (r.count !== 1) return false;
    await tx.yarnProgramInput.deleteMany({ where: { programId: id } });
    await tx.yarnProgramInput.createMany({ data: inputRows(inputs).map((l) => ({ ...l, programId: id })) });
    return true;
  },
  setStatus(tx: Tx, id: string, d: Prisma.YarnProgramUncheckedUpdateInput) {
    return tx.yarnProgram.update({ where: { id }, data: { ...d, version: { increment: 1 } } });
  },
  delete(tx: Tx, id: string) {
    return tx.yarnProgram.delete({ where: { id } });
  },
  /** Outward D.C.s (not cancelled) sent under the programme. */
  outwardCount(tx: Tx, id: string) {
    return tx.outwardDc.count({ where: { yarnProgramId: id, status: { not: 'CANCELLED' } } });
  },
  items(ids: string[], db: Db = prisma) {
    return db.item.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, type: true, isActive: true } });
  },
  process(id: string, db: Db = prisma) {
    return db.process.findUnique({ where: { id }, select: { id: true, code: true, name: true, isActive: true, stage: true } });
  },
  /** Approved programmes of open orders whose process the vendor does (delivery picker). */
  forVendor(vendorId: string) {
    return prisma.yarnProgram.findMany({
      where: { status: 'APPROVED', order: { status: { in: ['DRAFT', 'CONFIRMED'] } }, process: { vendors: { some: { vendorId } } } },
      include,
      orderBy: { programNo: 'asc' },
    });
  },
  /** Approved programmes for an order + process (opening-data import). */
  approvedFor(orderId: string, processId: string, db: Db = prisma) {
    return db.yarnProgram.findMany({ where: { orderId, processId, status: 'APPROVED' }, select: { id: true, programNo: true } });
  },
};
