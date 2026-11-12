import { Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const include = {
  order: { select: { id: true, orderNo: true, styleNo: true } },
  lines: { orderBy: { lineNo: 'asc' }, include: { item: { select: { id: true, code: true, name: true, unit: true, trimGroup: true } } } },
} satisfies Prisma.SplRequestInclude;
export type SplDetail = Prisma.SplRequestGetPayload<{ include: typeof include }>;
export type SplLineData = { itemId: string; colour?: string | null; size?: string | null; qty: string; reason?: string | null };
const rows = (lines: SplLineData[]) =>
  lines.map((l, i) => ({ lineNo: i + 1, itemId: l.itemId, colour: l.colour ?? null, size: l.size ?? null, qty: new Prisma.Decimal(l.qty), reason: l.reason ?? null }));

export const splRepo = {
  list(where: Prisma.SplRequestWhereInput, order: Prisma.SplRequestOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([prisma.splRequest.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include }), prisma.splRequest.count({ where })]);
  },
  get(id: string, db: Db = prisma) {
    return db.splRequest.findUnique({ where: { id }, include });
  },
  async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM spl_requests WHERE id = ${id}::uuid FOR UPDATE`;
  },
  create(tx: Tx, data: Omit<Prisma.SplRequestUncheckedCreateInput, 'lines'>, lines: SplLineData[]) {
    return tx.splRequest.create({ data: { ...data, lines: { create: rows(lines) } } });
  },
  async update(tx: Tx, id: string, version: number, data: Prisma.SplRequestUncheckedUpdateManyInput, lines: SplLineData[]) {
    const r = await tx.splRequest.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.splRequestLine.deleteMany({ where: { requestId: id } });
    await tx.splRequestLine.createMany({ data: rows(lines).map((l) => ({ ...l, requestId: id })) });
    return true;
  },
  delete(tx: Tx, id: string) {
    return tx.splRequest.delete({ where: { id } });
  },
  setState(tx: Tx, id: string, data: Prisma.SplRequestUncheckedUpdateInput) {
    return tx.splRequest.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  itemsByIds(ids: string[], db: Db = prisma) {
    return db.item.findMany({ where: { id: { in: ids } }, select: { id: true, type: true, isActive: true, code: true } });
  },
  /** Approved SPL lines for an order. */
  approvedLines(orderId: string) {
    return prisma.splRequestLine.findMany({ where: { request: { orderId, status: 'POSTED' } }, select: { itemId: true, colour: true, size: true, qty: true } });
  },
};
