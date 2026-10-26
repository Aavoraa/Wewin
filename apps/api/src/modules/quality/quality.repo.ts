import { type Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const include = {
  order: { select: { id: true, orderNo: true, styleNo: true, status: true, colours: true, sizes: true, garmentItemId: true, buyer: { select: { name: true } } } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      roll: { select: { id: true, rollNo: true, lot: true, colour: true, gsm: true, dia: true, kg: true, item: { select: { code: true, name: true } } } },
      bundle: { select: { id: true, bundleNo: true, componentCode: true, colour: true, size: true, pcs: true } },
    },
  },
} satisfies Prisma.QcInspectionInclude;
export type QcDetail = Prisma.QcInspectionGetPayload<{ include: typeof include }>;

export interface QcLineRow {
  rollId: string | null;
  bundleId: string | null;
  colour: string | null;
  size: string | null;
  operator: string | null;
  result: 'PASS' | 'HOLD' | 'REJECT' | null;
  gsm: number | null;
  defectPoints: number | null;
  checkedPcs: number | null;
  passedPcs: number | null;
  rejectedPcs: number | null;
  defects: Prisma.InputJsonValue;
  remarks: string | null;
}

export const qualityRepo = {
  list(where: Prisma.QcInspectionWhereInput, order: Prisma.QcInspectionOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.qcInspection.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include }),
      prisma.qcInspection.count({ where }),
    ]);
  },
  get(id: string, db: Db = prisma) {
    return db.qcInspection.findUnique({ where: { id }, include });
  },
  async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM qc_inspections WHERE id = ${id}::uuid FOR UPDATE`;
  },
  create(tx: Tx, data: Omit<Prisma.QcInspectionUncheckedCreateInput, 'lines'>, lines: QcLineRow[]) {
    return tx.qcInspection.create({ data: { ...data, lines: { create: lines.map((l, i) => ({ lineNo: i + 1, ...l })) } } });
  },
  async update(tx: Tx, id: string, version: number, data: Prisma.QcInspectionUncheckedUpdateManyInput, lines: QcLineRow[]) {
    const r = await tx.qcInspection.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.qcInspectionLine.deleteMany({ where: { inspectionId: id } });
    await tx.qcInspectionLine.createMany({ data: lines.map((l, i) => ({ inspectionId: id, lineNo: i + 1, ...l })) });
    return true;
  },
  delete(tx: Tx, id: string) {
    return tx.qcInspection.delete({ where: { id } });
  },
  setState(tx: Tx, id: string, data: Prisma.QcInspectionUncheckedUpdateInput) {
    return tx.qcInspection.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  rollsByIds(ids: string[], db: Db = prisma) {
    return db.fabricRoll.findMany({ where: { id: { in: ids } }, select: { id: true, rollNo: true, item: { select: { type: true } } } });
  },
  bundlesByIds(ids: string[], db: Db = prisma) {
    return db.cutBundle.findMany({ where: { id: { in: ids } }, select: { id: true, bundleNo: true, orderId: true, colour: true, size: true, lay: { select: { status: true } } } });
  },
  /** Latest approved fabric-inspection result of each roll (a later inspection overrides an earlier one). */
  async latestRollResults(rollIds: string[], db: Db = prisma) {
    if (!rollIds.length) return new Map<string, { result: 'PASS' | 'HOLD' | 'REJECT'; docNo: string }>();
    const rows = await db.$queryRaw<{ roll_id: string; result: 'PASS' | 'HOLD' | 'REJECT'; doc_no: string }[]>`
      SELECT DISTINCT ON (l.roll_id) l.roll_id, l.result::text AS result, q.doc_no
      FROM qc_inspection_lines l JOIN qc_inspections q ON q.id = l.inspection_id
      WHERE q.status = 'POSTED' AND q.kind = 'FABRIC_ROLL' AND l.roll_id = ANY(${rollIds}::uuid[]) AND l.result IS NOT NULL
      ORDER BY l.roll_id, q.posted_at DESC`;
    return new Map(rows.map((r) => [r.roll_id, { result: r.result, docNo: r.doc_no }]));
  },
  /** Pieces passed in approved final inspections of an order, per colour × size. */
  async finalPassed(orderId: string, db: Db = prisma) {
    const rows = await db.$queryRaw<{ colour: string; size: string; passed: bigint }[]>`
      SELECT l.colour, l.size, COALESCE(SUM(l.passed_pcs), 0) AS passed
      FROM qc_inspection_lines l JOIN qc_inspections q ON q.id = l.inspection_id
      WHERE q.status = 'POSTED' AND q.kind = 'FINAL' AND q.order_id = ${orderId}::uuid
      GROUP BY l.colour, l.size`;
    return new Map(rows.map((r) => [`${r.colour}|${r.size}`, Number(r.passed)]));
  },
  /** Recent defect counts by code, from approved inline / final checks (for the summary). */
  async defectSummary(from: Date, db: Db = prisma) {
    return db.$queryRaw<{ kind: string; code: string; count: bigint }[]>`
      SELECT q.kind::text AS kind, d->>'code' AS code, SUM((d->>'count')::int) AS count
      FROM qc_inspections q JOIN qc_inspection_lines l ON l.inspection_id = q.id
      CROSS JOIN LATERAL jsonb_array_elements(l.defects) d
      WHERE q.status = 'POSTED' AND q.doc_date >= ${from}
      GROUP BY q.kind, d->>'code' ORDER BY count DESC`;
  },
  pendingCount(db: Db = prisma) {
    return db.qcInspection.count({ where: { status: 'DRAFT' } });
  },
};
