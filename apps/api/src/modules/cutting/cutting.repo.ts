import { Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const include = {
  order: { select: { id: true, orderNo: true, styleNo: true, status: true, buyer: { select: { name: true } } } },
  rolls: { orderBy: { lineNo: 'asc' }, include: { roll: { select: { id: true, rollNo: true, itemId: true, lot: true, colour: true, kg: true, gsm: true, dia: true, item: { select: { code: true, name: true } } } } } },
  bundles: { orderBy: { lineNo: 'asc' }, include: { panelItem: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.CutLayInclude;
export type CutLayDetail = Prisma.CutLayGetPayload<{ include: typeof include }>;

export const cuttingRepo = {
  list(where: Prisma.CutLayWhereInput, order: Prisma.CutLayOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.cutLay.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include }),
      prisma.cutLay.count({ where }),
    ]);
  },
  get(id: string, db: Db = prisma) {
    return db.cutLay.findUnique({ where: { id }, include });
  },
  async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM cut_lays WHERE id = ${id}::uuid FOR UPDATE`;
  },
  create(
    tx: Tx,
    data: Omit<Prisma.CutLayUncheckedCreateInput, 'rolls' | 'bundles'>,
    rolls: { rollId: string; kgUsed: string }[],
    bundles: { componentCode: string; panelItemId: string; colour: string; size: string; pcs: number; orderId: string }[],
  ) {
    return tx.cutLay.create({
      data: {
        ...data,
        rolls: { create: rolls.map((r, i) => ({ lineNo: i + 1, rollId: r.rollId, kgUsed: new Prisma.Decimal(r.kgUsed) })) },
        bundles: { create: bundles.map((b, i) => ({ lineNo: i + 1, ...b })) },
      },
    });
  },
  async update(
    tx: Tx,
    id: string,
    version: number,
    data: Prisma.CutLayUncheckedUpdateManyInput,
    rolls: { rollId: string; kgUsed: string }[],
    bundles: { componentCode: string; panelItemId: string; colour: string; size: string; pcs: number; orderId: string }[],
  ) {
    const r = await tx.cutLay.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.cutLayRoll.deleteMany({ where: { layId: id } });
    await tx.cutBundle.deleteMany({ where: { layId: id } });
    await tx.cutLayRoll.createMany({ data: rolls.map((x, i) => ({ layId: id, lineNo: i + 1, rollId: x.rollId, kgUsed: new Prisma.Decimal(x.kgUsed) })) });
    await tx.cutBundle.createMany({ data: bundles.map((b, i) => ({ layId: id, lineNo: i + 1, ...b })) });
    return true;
  },
  delete(tx: Tx, id: string) {
    return tx.cutLay.delete({ where: { id } });
  },
  setState(tx: Tx, id: string, data: Prisma.CutLayUncheckedUpdateInput) {
    return tx.cutLay.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  numberBundle(tx: Tx, id: string, bundleNo: string) {
    return tx.cutBundle.update({ where: { id }, data: { bundleNo } });
  },
  rollsByIds(ids: string[], db: Db = prisma) {
    return db.fabricRoll.findMany({ where: { id: { in: ids } }, include: { item: { select: { type: true, code: true } } } });
  },

  // ── Bundles ──
  bundles(where: Prisma.CutBundleWhereInput, p: Paging) {
    return prisma.$transaction([
      prisma.cutBundle.findMany({
        where: { ...where, lay: { status: 'POSTED' } },
        orderBy: [{ bundleNo: 'asc' }],
        skip: p.skip,
        take: p.take,
        include: { panelItem: { select: { code: true, name: true } }, lay: { select: { docNo: true, docDate: true, order: { select: { orderNo: true, styleNo: true } } } } },
      }),
      prisma.cutBundle.count({ where: { ...where, lay: { status: 'POSTED' } } }),
    ]);
  },
  bundleByNo(bundleNo: string, db: Db = prisma) {
    return db.cutBundle.findUnique({
      where: { bundleNo },
      include: { panelItem: { select: { code: true, name: true } }, lay: { select: { docNo: true, status: true, order: { select: { orderNo: true, styleNo: true, buyer: { select: { name: true } } } } } } },
    });
  },
  bundlesByIds(ids: string[], db: Db = prisma) {
    return db.cutBundle.findMany({ where: { id: { in: ids } }, include: { lay: { select: { status: true } } } });
  },
};
