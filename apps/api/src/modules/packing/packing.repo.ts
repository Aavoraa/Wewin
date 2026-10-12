import { Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const cartonInclude = {
  order: { select: { id: true, orderNo: true, styleNo: true, buyerPoNo: true, buyer: { select: { name: true } } } },
  packingList: { select: { id: true, docNo: true, status: true } },
  lines: { orderBy: [{ colour: 'asc' }, { size: 'asc' }] },
} satisfies Prisma.CartonInclude;
export type CartonDetail = Prisma.CartonGetPayload<{ include: typeof cartonInclude }>;

const plInclude = {
  order: { select: { id: true, orderNo: true, styleNo: true, buyerPoNo: true, currency: true, sizes: true, colours: true, buyer: { select: { name: true, country: true } } } },
  cartons: { orderBy: { cartonSeq: 'asc' }, include: { lines: true } },
} satisfies Prisma.PackingListInclude;
export type PackingListDetail = Prisma.PackingListGetPayload<{ include: typeof plInclude }>;

interface CartonData {
  docDate: Date;
  orderId: string;
  grossKg: string | null;
  netKg: string | null;
  lengthCm: string | null;
  widthCm: string | null;
  heightCm: string | null;
  remarks: string | null;
}
const dec = (v: string | null) => (v === null ? null : new Prisma.Decimal(v));
const cartonRow = (d: CartonData) => ({ ...d, grossKg: dec(d.grossKg), netKg: dec(d.netKg), lengthCm: dec(d.lengthCm), widthCm: dec(d.widthCm), heightCm: dec(d.heightCm) });

export const packingRepo = {
  // ── Cartons ──
  listCartons(where: Prisma.CartonWhereInput, order: Prisma.CartonOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.carton.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include: cartonInclude }),
      prisma.carton.count({ where }),
    ]);
  },
  getCarton(id: string, db: Db = prisma) {
    return db.carton.findUnique({ where: { id }, include: cartonInclude });
  },
  cartonByNo(docNo: string) {
    return prisma.carton.findUnique({ where: { docNo }, include: cartonInclude });
  },
  async lockCarton(tx: Tx, ids: string[]) {
    if (!ids.length) return;
    await tx.$queryRaw`SELECT 1 FROM cartons WHERE id = ANY(${[...new Set(ids)].sort()}::uuid[]) ORDER BY id FOR UPDATE`;
  },
  createCarton(tx: Tx, data: CartonData & { createdById: string }, lines: { colour: string; size: string; pcs: number }[]) {
    return tx.carton.create({ data: { ...cartonRow(data), createdById: data.createdById, lines: { create: lines } } });
  },
  async updateCarton(tx: Tx, id: string, version: number, data: CartonData, lines: { colour: string; size: string; pcs: number }[]) {
    const r = await tx.carton.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...cartonRow(data), version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.cartonLine.deleteMany({ where: { cartonId: id } });
    await tx.cartonLine.createMany({ data: lines.map((l) => ({ ...l, cartonId: id })) });
    return true;
  },
  deleteCarton(tx: Tx, id: string) {
    return tx.carton.delete({ where: { id } });
  },
  setCartonState(tx: Tx, id: string, data: Prisma.CartonUncheckedUpdateInput) {
    return tx.carton.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  async nextCartonSeq(tx: Tx, orderId: string) {
    await tx.$queryRaw`SELECT 1 FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    const r = await tx.carton.aggregate({ where: { orderId }, _max: { cartonSeq: true } });
    return (r._max.cartonSeq ?? 0) + 1;
  },
  cartonsByIds(ids: string[], db: Db = prisma) {
    return db.carton.findMany({ where: { id: { in: ids } }, include: { lines: true } });
  },

  // ── Packing lists ──
  listPls(where: Prisma.PackingListWhereInput, p: Paging) {
    return prisma.$transaction([
      prisma.packingList.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: plInclude }),
      prisma.packingList.count({ where }),
    ]);
  },
  getPl(id: string, db: Db = prisma) {
    return db.packingList.findUnique({ where: { id }, include: plInclude });
  },
  async lockPl(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM packing_lists WHERE id = ${id}::uuid FOR UPDATE`;
  },
  createPl(tx: Tx, data: Omit<Prisma.PackingListUncheckedCreateInput, 'cartons'>) {
    return tx.packingList.create({ data });
  },
  async updatePl(tx: Tx, id: string, version: number, data: Prisma.PackingListUncheckedUpdateManyInput) {
    const r = await tx.packingList.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    return r.count === 1;
  },
  setPlState(tx: Tx, id: string, data: Prisma.PackingListUncheckedUpdateInput) {
    return tx.packingList.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  deletePl(tx: Tx, id: string) {
    return tx.packingList.delete({ where: { id } });
  },
  attachCartons(tx: Tx, plId: string, cartonIds: string[]) {
    return tx.carton.updateMany({ where: { id: { in: cartonIds } }, data: { packingListId: plId } });
  },
  detachCartons(tx: Tx, plId: string) {
    return tx.carton.updateMany({ where: { packingListId: plId }, data: { packingListId: null } });
  },
};
