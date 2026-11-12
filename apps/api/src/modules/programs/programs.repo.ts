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
  inputItemId: string | null;
  outputItemId: string | null;
  allowedLossPct: string;
  materialCostPerKg: string | null;
  plannedVendorId: string | null;
}

/** Programme entry fields (Q-067), stored as given. */
export interface ProgramSpecData {
  portion: string | null;
  printColour: string | null;
  fabricDescription: string | null;
  fabricType: string | null;
  greyGsm: number | null;
  gauge: string | null;
  loopLength: string | null;
  uom: string;
  mtrToKg: string | null;
  collarCuffReqd: number | null;
  withMeasurement: boolean;
  measureUnit: string;
  tubSingle: string | null;
  processTemplate: string | null;
  yarnMix: Prisma.InputJsonValue;
  sizeSpecs: Prisma.InputJsonValue;
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
    data: { programNo: string; orderId: string; fabricItemId: string | null; colour: string | null; requiredKg: string | null; gsm: number | null; dia: string | null; remarks: string | null; sourceScanId: string | null } & ProgramSpecData,
    processes: ProcessRowData[],
  ) {
    return tx.fabricProgram.create({
      data: {
        ...data,
        requiredKg: dec(data.requiredKg),
        mtrToKg: dec(data.mtrToKg),
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
    data: { fabricItemId: string | null; colour: string | null; requiredKg: string | null; gsm: number | null; dia: string | null; remarks: string | null } & ProgramSpecData,
    processes: ProcessRowData[],
  ) {
    const r = await tx.fabricProgram.updateMany({
      where: { id, version },
      data: { ...data, requiredKg: dec(data.requiredKg), mtrToKg: dec(data.mtrToKg), version: { increment: 1 } },
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
  /** Program processes of an order's approved programs for one process. */
  approvedProcesses(orderId: string, processId: string, db: Db = prisma) {
    return db.fabricProgramProcess.findMany({ where: { processId, program: { orderId, status: 'APPROVED' } }, select: { id: true, inputItemId: true, outputItemId: true, program: { select: { programNo: true } } } });
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
  /** An order's approved programmes with what the yarn requirement needs (Q-073). */
  approvedForYarn(orderId: string, db: Db = prisma) {
    return db.fabricProgram.findMany({
      where: { orderId, status: 'APPROVED' },
      orderBy: { programNo: 'asc' },
      select: {
        programNo: true,
        colour: true,
        requiredKg: true,
        yarnMix: true,
        processes: { select: { sequence: true, allowedLossPct: true, inputItemId: true, inputItem: { select: { type: true } } } },
      },
    });
  },
  itemNames(ids: string[], db: Db = prisma) {
    return db.item.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, type: true } });
  },
  /** Programme created from a scan (one per scan). */
  bySourceScan(scanId: string) {
    return prisma.fabricProgram.findUnique({ where: { sourceScanId: scanId }, select: { id: true, programNo: true, status: true } });
  },
  /** The fabric item last used on a programme with this fabric description (Q-068: "it remembers"). */
  async fabricForDescription(description: string) {
    const r = await prisma.fabricProgram.findFirst({
      where: { fabricDescription: { equals: description, mode: 'insensitive' }, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      select: { fabricItemId: true },
    });
    return r?.fabricItemId ?? null;
  },
  /** Yarn items last used for these counts in programme yarn mixes. */
  async yarnsForCounts(counts: string[]) {
    if (!counts.length) return new Map<string, string>();
    const rows = await prisma.$queryRaw<{ counts: string; item_id: string }[]>`
      SELECT DISTINCT ON (lower(m->>'counts')) lower(m->>'counts') AS counts, m->>'yarnItemId' AS item_id
      FROM fabric_programs p CROSS JOIN LATERAL jsonb_array_elements(p.yarn_mix) m
      WHERE p.status <> 'CANCELLED' AND m->>'yarnItemId' IS NOT NULL AND lower(m->>'counts') = ANY(${counts.map((c) => c.toLowerCase())}::text[])
      ORDER BY lower(m->>'counts'), p.created_at DESC`;
    return new Map(rows.map((r) => [r.counts, r.item_id]));
  },
  /** Prs.Template (Q-067): each template name with the process route of the latest programme that used it. */
  async processTemplates() {
    const rows = await prisma.fabricProgram.findMany({
      where: { processTemplate: { not: null }, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      select: { processTemplate: true, processes: { orderBy: { sequence: 'asc' }, select: { sequence: true, processId: true, allowedLossPct: true } } },
    });
    const seen = new Map<string, (typeof rows)[number]['processes']>();
    for (const r of rows) {
      const k = r.processTemplate!.trim().toUpperCase();
      if (k && !seen.has(k)) seen.set(k, r.processes);
    }
    return [...seen.entries()].map(([name, processes]) => ({ name, processes: processes.map((p) => ({ sequence: p.sequence, processId: p.processId, allowedLossPct: p.allowedLossPct.toString() })) }));
  },
  activeKgProcesses() {
    return prisma.process.findMany({ where: { isActive: true, stage: 'KG' }, select: { id: true, code: true, name: true } });
  },
  processesByIds(ids: string[], db: Db = prisma) {
    return db.process.findMany({ where: { id: { in: ids } }, select: { id: true, stage: true, code: true, isActive: true } });
  },

  // ── Trims BOM ──
  bom(orderId: string, db: Db = prisma) {
    return db.trimsBomLine.findMany({
      where: { orderId },
      include: { trimItem: { select: { id: true, code: true, name: true, unit: true, trimGroup: true } } },
      orderBy: [{ trimItem: { trimGroup: 'asc' } }, { trimItem: { name: 'asc' } }],
    });
  },
  async replaceBom(
    tx: Tx,
    orderId: string,
    lines: {
      trimItemId: string;
      colour: string | null;
      size: string | null;
      qtyPerGarment: string;
      wastagePct: string;
      remarks: string | null;
      country: string | null;
      garDefine: string | null;
      sizewise: boolean;
      colourwise: boolean;
      consumption: string;
    }[],
  ) {
    await tx.trimsBomLine.deleteMany({ where: { orderId } });
    if (lines.length) {
      await tx.trimsBomLine.createMany({
        data: lines.map((l) => ({ ...l, orderId, qtyPerGarment: new Prisma.Decimal(l.qtyPerGarment), wastagePct: new Prisma.Decimal(l.wastagePct) })),
      });
    }
  },
};
