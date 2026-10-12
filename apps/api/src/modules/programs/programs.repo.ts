import { Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const include = {
  order: { select: { id: true, orderNo: true, status: true, styleNo: true } },
  fabricItem: { select: { id: true, code: true, name: true } },
  processes: {
    orderBy: { sequence: 'asc' },
    include: {
      process: { select: { id: true, code: true, name: true, stage: true } },
      inputItem: { select: { id: true, code: true, name: true } },
      outputItem: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.FabricProgramInclude;
export type ProgramDetail = Prisma.FabricProgramGetPayload<{ include: typeof include }>;

export interface ProcessRowData {
  sequence: number;
  processId: string;
  inputItemId: string;
  outputItemId: string;
  allowedLossPct: string;
  materialCostPerKg: string | null;
  plannedVendorId: string | null;
}

const dec = (v: string | null) => (v === null ? null : new Prisma.Decimal(v));

export const programsRepo = {
  list(where: Prisma.FabricProgramWhereInput, order: Prisma.FabricProgramOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.fabricProgram.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include }),
      prisma.fabricProgram.count({ where }),
    ]);
  },
  get(id: string, db: Db = prisma) {
    return db.fabricProgram.findUnique({ where: { id }, include });
  },
  async getForUpdate(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM fabric_programs WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.fabricProgram.findUnique({ where: { id }, include });
  },
  countForOrder(tx: Tx, orderId: string) {
    return tx.fabricProgram.count({ where: { orderId } });
  },
  create(
    tx: Tx,
    data: { programNo: string; orderId: string; fabricItemId: string; colour: string | null; requiredKg: string; gsm: number | null; dia: string | null; remarks: string | null },
    processes: ProcessRowData[],
  ) {
    return tx.fabricProgram.create({
      data: {
        ...data,
        requiredKg: new Prisma.Decimal(data.requiredKg),
        processes: {
          create: processes.map((p) => ({ ...p, allowedLossPct: new Prisma.Decimal(p.allowedLossPct), materialCostPerKg: dec(p.materialCostPerKg) })),
        },
      },
    });
  },
  async update(
    tx: Tx,
    id: string,
    version: number,
    data: { fabricItemId: string; colour: string | null; requiredKg: string; gsm: number | null; dia: string | null; remarks: string | null },
    processes: ProcessRowData[],
  ) {
    const r = await tx.fabricProgram.updateMany({
      where: { id, version },
      data: { ...data, requiredKg: new Prisma.Decimal(data.requiredKg), version: { increment: 1 } },
    });
    if (r.count === 0) return false;
    await tx.fabricProgramProcess.deleteMany({ where: { programId: id } });
    await tx.fabricProgramProcess.createMany({
      data: processes.map((p) => ({ ...p, programId: id, allowedLossPct: new Prisma.Decimal(p.allowedLossPct), materialCostPerKg: dec(p.materialCostPerKg) })),
    });
    return true;
  },
  setStatus(tx: Tx, id: string, data: Prisma.FabricProgramUncheckedUpdateInput) {
    return tx.fabricProgram.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  delete(tx: Tx, id: string) {
    return tx.fabricProgram.delete({ where: { id } });
  },
  processRow(id: string, db: Db = prisma) {
    return db.fabricProgramProcess.findUnique({
      where: { id },
      include: {
        process: { select: { id: true, code: true, name: true, stage: true } },
        program: { select: { id: true, programNo: true, orderId: true, status: true } },
      },
    });
  },
  itemsByIds(ids: string[], db: Db = prisma) {
    return db.item.findMany({ where: { id: { in: ids } }, select: { id: true, type: true, code: true } });
  },
  processesByIds(ids: string[], db: Db = prisma) {
    return db.process.findMany({ where: { id: { in: ids } }, select: { id: true, stage: true, code: true, isActive: true } });
  },

  // ── Trims BOM ──
  bom(orderId: string, db: Db = prisma) {
    return db.trimsBomLine.findMany({
      where: { orderId },
      include: { trimItem: { select: { id: true, code: true, name: true, unit: true } } },
      orderBy: [{ trimItem: { code: 'asc' } }],
    });
  },
  async replaceBom(
    tx: Tx,
    orderId: string,
    lines: { trimItemId: string; colour: string | null; size: string | null; qtyPerGarment: string; wastagePct: string; remarks: string | null }[],
  ) {
    await tx.trimsBomLine.deleteMany({ where: { orderId } });
    if (lines.length) {
      await tx.trimsBomLine.createMany({
        data: lines.map((l) => ({ ...l, orderId, qtyPerGarment: new Prisma.Decimal(l.qtyPerGarment), wastagePct: new Prisma.Decimal(l.wastagePct) })),
      });
    }
  },
};
