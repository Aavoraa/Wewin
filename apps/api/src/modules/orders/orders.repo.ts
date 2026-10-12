import { Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const detailInclude = {
  buyer: { select: { id: true, code: true, name: true, currency: true } },
  garmentItem: { select: { id: true, code: true, name: true } },
  lines: { orderBy: [{ colour: 'asc' }, { size: 'asc' }] },
  components: { orderBy: { sortOrder: 'asc' }, include: { panelItem: { select: { id: true, code: true, name: true } } } },
  costing: { include: { lines: { orderBy: { sortOrder: 'asc' } } } },
  programs: { select: { id: true, programNo: true, status: true, requiredKg: true, fabricItem: { select: { code: true, name: true } } } },
} satisfies Prisma.OrderInclude;

export type OrderDetail = Prisma.OrderGetPayload<{ include: typeof detailInclude }>;

interface LineData {
  colour: string;
  size: string;
  qty: number;
  unitPrice: string | null;
}
interface ComponentData {
  code: string;
  name: string;
  panelItemId: string;
  pcsPerGarment: number;
}

export const ordersRepo = {
  list(where: Prisma.OrderWhereInput, order: Prisma.OrderOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.order.findMany({
        where,
        orderBy: order,
        skip: p.skip,
        take: p.take,
        include: { buyer: { select: { code: true, name: true } } },
      }),
      prisma.order.count({ where }),
    ]);
  },

  qtyByOrder(ids: string[]) {
    return prisma.orderLine.groupBy({ by: ['orderId'], where: { orderId: { in: ids } }, _sum: { qty: true } });
  },

  get(id: string, db: Db = prisma) {
    return db.order.findUnique({ where: { id }, include: detailInclude });
  },

  getForUpdate: async (tx: Tx, id: string) => {
    await tx.$queryRaw`SELECT 1 FROM orders WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.order.findUnique({ where: { id }, include: detailInclude });
  },

  create(tx: Tx, data: Omit<Prisma.OrderUncheckedCreateInput, 'lines' | 'components'>, lines: LineData[], components: ComponentData[]) {
    return tx.order.create({
      data: {
        ...data,
        lines: { create: lines.map((l) => ({ ...l, unitPrice: l.unitPrice ? new Prisma.Decimal(l.unitPrice) : null })) },
        components: { create: components.map((c, i) => ({ ...c, sortOrder: i })) },
      },
    });
  },

  async update(tx: Tx, id: string, version: number, data: Prisma.OrderUncheckedUpdateManyInput) {
    const r = await tx.order.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
    return r.count === 1;
  },

  /** Replace the matrix; unchanged cells are updated in place so their ids stay stable. */
  async replaceLines(tx: Tx, orderId: string, lines: LineData[]) {
    const keep = lines.map((l) => `${l.colour}|${l.size}`);
    const existing = await tx.orderLine.findMany({ where: { orderId } });
    const remove = existing.filter((e) => !keep.includes(`${e.colour}|${e.size}`)).map((e) => e.id);
    if (remove.length) await tx.orderLine.deleteMany({ where: { id: { in: remove } } });
    for (const l of lines) {
      await tx.orderLine.upsert({
        where: { orderId_colour_size: { orderId, colour: l.colour, size: l.size } },
        create: { orderId, ...l, unitPrice: l.unitPrice ? new Prisma.Decimal(l.unitPrice) : null },
        update: { qty: l.qty, unitPrice: l.unitPrice ? new Prisma.Decimal(l.unitPrice) : null },
      });
    }
  },

  async replaceComponents(tx: Tx, orderId: string, components: ComponentData[]) {
    await tx.orderComponent.deleteMany({ where: { orderId, code: { notIn: components.map((c) => c.code) } } });
    for (const [i, c] of components.entries()) {
      await tx.orderComponent.upsert({
        where: { orderId_code: { orderId, code: c.code } },
        create: { orderId, ...c, sortOrder: i },
        update: { name: c.name, panelItemId: c.panelItemId, pcsPerGarment: c.pcsPerGarment, sortOrder: i },
      });
    }
  },

  setStatus(tx: Tx, id: string, data: Prisma.OrderUncheckedUpdateInput) {
    return tx.order.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },

  delete(tx: Tx, id: string) {
    return tx.order.delete({ where: { id } });
  },

  // ── Costing ──
  getCosting(orderId: string, db: Db = prisma) {
    return db.orderCosting.findUnique({ where: { orderId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
  },

  async upsertCosting(
    tx: Tx,
    orderId: string,
    data: { panelCostPerPiece: string | null; fobPerPiece: string | null; exchangeRate: string | null; remarks: string | null },
    lines: { head: string; basis: string; consumption: string; rate: string }[],
  ) {
    const dec = (v: string | null) => (v ? new Prisma.Decimal(v) : null);
    const row = { panelCostPerPiece: dec(data.panelCostPerPiece), fobPerPiece: dec(data.fobPerPiece), exchangeRate: dec(data.exchangeRate), remarks: data.remarks };
    const c = await tx.orderCosting.upsert({
      where: { orderId },
      create: { orderId, ...row },
      update: { ...row, version: { increment: 1 } },
    });
    await tx.orderCostingLine.deleteMany({ where: { costingId: c.id } });
    if (lines.length) {
      await tx.orderCostingLine.createMany({
        data: lines.map((l, i) => ({ costingId: c.id, sortOrder: i, head: l.head, basis: l.basis, consumption: new Prisma.Decimal(l.consumption), rate: new Prisma.Decimal(l.rate) })),
      });
    }
    return c;
  },

  itemsByIds(ids: string[], db: Db = prisma) {
    return db.item.findMany({ where: { id: { in: ids } }, select: { id: true, type: true, isActive: true, code: true } });
  },

  search(q: string, take = 10) {
    return prisma.order.findMany({
      where: {
        status: { not: 'CANCELLED' },
        OR: [
          { orderNo: { contains: q, mode: 'insensitive' } },
          { buyerPoNo: { contains: q, mode: 'insensitive' } },
          { styleNo: { contains: q, mode: 'insensitive' } },
        ],
      },
      take,
      orderBy: { poDate: 'desc' },
      select: { id: true, orderNo: true, buyerPoNo: true, styleNo: true, status: true, buyer: { select: { name: true } } },
    });
  },
};
