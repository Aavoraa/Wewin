import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { type zCartonInput, type zPackingListInput, type zProductionListQuery } from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { numbering } from '../../core/numbering/numbering.service';
import { ledger } from '../../core/ledger/ledger.service';
import { assertDraft, assertPosted, dateOnly, toDbDate } from '../../core/documents';
import { type CurrentUser } from '../../core/auth/auth.types';
import { mastersService } from '../masters/masters.service';
import { ordersService } from '../orders/orders.service';
import { type CartonDetail, type PackingListDetail, packingRepo as repo } from './packing.repo';

export const DOC_CARTON = 'CARTON';
type CartonInput = z.output<typeof zCartonInput>;
type PlInput = z.output<typeof zPackingListInput>;
const RC = { isolation: 'ReadCommitted' } as const;

const shapeCarton = (c: CartonDetail) => ({
  ...c,
  docDate: dateOnly(c.docDate)!,
  grossKg: c.grossKg?.toFixed(3) ?? null,
  netKg: c.netKg?.toFixed(3) ?? null,
  lengthCm: c.lengthCm?.toString() ?? null,
  widthCm: c.widthCm?.toString() ?? null,
  heightCm: c.heightCm?.toString() ?? null,
  totalPcs: c.lines.reduce((a, l) => a + l.pcs, 0),
});

function shapePl(p: PackingListDetail) {
  const cartons = p.cartons.map((c) => ({ ...c, docDate: dateOnly(c.docDate), grossKg: c.grossKg?.toFixed(3) ?? null, netKg: c.netKg?.toFixed(3) ?? null, totalPcs: c.lines.reduce((a, l) => a + l.pcs, 0) }));
  const gross = cartons.reduce((a, c) => a + Number(c.grossKg ?? 0), 0);
  const net = cartons.reduce((a, c) => a + Number(c.netKg ?? 0), 0);
  const byCell: Record<string, number> = {};
  for (const c of p.cartons) for (const l of c.lines) byCell[`${l.colour}|${l.size}`] = (byCell[`${l.colour}|${l.size}`] ?? 0) + l.pcs;
  return {
    ...p,
    docDate: dateOnly(p.docDate)!,
    cartons,
    // Display totals only (weights are informational, not business calculations).
    totals: { cartons: cartons.length, pcs: cartons.reduce((a, c) => a + c.totalPcs, 0), grossKg: gross.toFixed(3), netKg: net.toFixed(3), byCell },
  };
}

async function validateCarton(input: Pick<CartonInput, 'orderId' | 'lines'>, db: Tx | typeof prisma) {
  const order = await ordersService.requireOpen(input.orderId, db);
  input.lines.forEach((l, i) => {
    if (!order.colours.includes(l.colour) || !order.sizes.includes(l.size)) throw new AppError('VALIDATION_ERROR', `Line ${i + 1}: ${l.colour} / ${l.size} is not on the order`, 400);
  });
  return order;
}
const cartonData = (i: CartonInput) => ({
  docDate: toDbDate(i.docDate),
  orderId: i.orderId,
  grossKg: i.grossKg,
  netKg: i.netKg,
  lengthCm: i.lengthCm,
  widthCm: i.widthCm,
  heightCm: i.heightCm,
  remarks: i.remarks,
});

export const packingService = {
  // ═════════ Cartons: FINISHING → FG_STORE ═════════
  async listCartons(q: z.output<typeof zProductionListQuery> & { unlisted?: string }) {
    const p = paging(q);
    const where: Prisma.CartonWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.unlisted === 'true' ? { packingListId: null, status: 'POSTED' } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { order: { orderNo: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await repo.listCartons(where, orderBy<Prisma.CartonOrderByWithRelationInput>(q.sort, { docDate: (d) => ({ docDate: d }), cartonSeq: (d) => ({ cartonSeq: d }), docNo: (d) => ({ docNo: d }) }, { createdAt: 'desc' }), p);
    return { rows: rows.map(shapeCarton), total, p };
  },
  async getCarton(id: string) {
    const c = await repo.getCarton(id);
    if (!c) throw notFound('Carton');
    return shapeCarton(c);
  },
  async cartonByNo(no: string) {
    const c = await repo.cartonByNo(no);
    if (!c) throw notFound(`Carton ${no}`);
    return shapeCarton(c);
  },
  async createCarton(input: CartonInput, user: CurrentUser) {
    await validateCarton(input, prisma);
    const id = await withTx(async (tx) => (await repo.createCarton(tx, { ...cartonData(input), createdById: user.id }, input.lines)).id, RC);
    return this.getCarton(id);
  },
  async updateCarton(id: string, input: CartonInput & { version: number }) {
    await validateCarton(input, prisma);
    await withTx(async (tx) => {
      const cur = await repo.getCarton(id, tx);
      if (!cur) throw notFound('Carton');
      assertDraft(cur, 'Carton');
      if (!(await repo.updateCarton(tx, id, input.version, cartonData(input), input.lines))) throw versionConflict();
    }, RC);
    return this.getCarton(id);
  },
  async removeCarton(id: string) {
    await withTx(async (tx) => {
      const cur = await repo.getCarton(id, tx);
      if (!cur) throw notFound('Carton');
      assertDraft(cur, 'Carton');
      await repo.deleteCarton(tx, id);
    }, RC);
  },
  async postCarton(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockCarton(tx, [id]);
      const c = await repo.getCarton(id, tx);
      if (!c) throw notFound('Carton');
      assertDraft(c, 'Carton');
      const order = await validateCarton({ orderId: c.orderId, lines: c.lines.map((l) => ({ colour: l.colour, size: l.size, pcs: l.pcs })) }, tx);
      const loc = await mastersService.systemLocations(['FINISHING', 'FG_STORE'], tx);
      const docDate = dateOnly(c.docDate)!;
      const seq = await repo.nextCartonSeq(tx, c.orderId);
      const { docNo } = await numbering.next('CARTON', docDate, tx);
      try {
        await ledger.post(
          tx,
          { type: DOC_CARTON, id, docDate },
          c.lines.map((l) => ({ itemId: order.garmentItemId, qty: String(l.pcs), unit: 'PCS' as const, colour: l.colour, size: l.size, cartonId: id, orderId: c.orderId, fromLocationId: loc.FINISHING, toLocationId: loc.FG_STORE, lineKey: l.id })),
          user.id,
        );
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK') throw new AppError('NEGATIVE_STOCK', 'Not enough finished garments for this carton (check sewing output)', 409, e.details);
        throw e;
      }
      await repo.setCartonState(tx, id, { status: 'POSTED', docNo, cartonSeq: seq, postedAt: new Date(), postedById: user.id });
      await audit.log(tx, { docType: DOC_CARTON, recordId: id, action: 'POST', docNo });
    });
    return this.getCarton(id);
  },
  /** Cancel: refused while on a packing list, or once the carton itself has left FG_STORE. */
  async cancelCarton(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockCarton(tx, [id]);
      const c = await repo.getCarton(id, tx);
      if (!c) throw notFound('Carton');
      assertPosted(c, 'cancelled', 'Carton');
      if (c.packingListId) throw new AppError('DOC_HAS_DEPENDENTS', `Carton is on packing list ${c.packingList?.docNo ?? '(draft)'}; remove it first`, 409);
      const { FG_STORE } = await mastersService.systemLocations(['FG_STORE'], tx);
      try {
        await ledger.assertUnitsAvailable(tx, 'carton', [{ id, qty: String(c.lines.reduce((a, l) => a + l.pcs, 0)), label: c.docNo ?? id }], FG_STORE);
        await ledger.reverse(tx, { type: DOC_CARTON, id }, user.id);
      } catch (e) {
        if (e instanceof AppError && e.code === 'NEGATIVE_STOCK') throw new AppError('DOC_HAS_DEPENDENTS', 'This carton has already been shipped', 409, e.details);
        throw e;
      }
      await repo.setCartonState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason });
      await audit.log(tx, { docType: DOC_CARTON, recordId: id, action: 'CANCEL', reason, docNo: c.docNo });
    });
    return this.getCarton(id);
  },

  // ═════════ Packing lists (non-stock) ═════════
  async listPls(q: z.output<typeof zProductionListQuery>) {
    const p = paging(q);
    const where: Prisma.PackingListWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.q ? { OR: [{ docNo: { contains: q.q, mode: 'insensitive' } }, { order: { orderNo: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await repo.listPls(where, p);
    return { rows: rows.map(shapePl), total, p };
  },
  async getPl(id: string, db: Tx | typeof prisma = prisma) {
    const pl = await repo.getPl(id, db);
    if (!pl) throw notFound('Packing list');
    return shapePl(pl);
  },
  async validatePlCartons(input: PlInput, tx: Tx, selfId?: string) {
    await ordersService.requireOpen(input.orderId, tx);
    await repo.lockCarton(tx, input.cartonIds);
    const cartons = await repo.cartonsByIds(input.cartonIds, tx);
    if (cartons.length !== input.cartonIds.length) throw new AppError('VALIDATION_ERROR', 'Unknown carton selected', 400);
    for (const c of cartons) {
      if (c.status !== 'POSTED') throw new AppError('VALIDATION_ERROR', `Carton ${c.docNo ?? '(draft)'} is not posted`, 400);
      if (c.orderId !== input.orderId) throw new AppError('VALIDATION_ERROR', `Carton ${c.docNo} belongs to another order`, 400);
      if (c.packingListId && c.packingListId !== selfId) throw new AppError('CONFLICT', `Carton ${c.docNo} is already on another packing list`, 409);
    }
  },
  async createPl(input: PlInput, _user?: CurrentUser) {
    const id = await withTx(async (tx) => {
      await this.validatePlCartons(input, tx);
      const pl = await repo.createPl(tx, { docDate: toDbDate(input.docDate), orderId: input.orderId, remarks: input.remarks });
      await repo.attachCartons(tx, pl.id, input.cartonIds);
      return pl.id;
    });
    return this.getPl(id);
  },
  async updatePl(id: string, input: PlInput & { version: number }) {
    await withTx(async (tx) => {
      await repo.lockPl(tx, id);
      const cur = await repo.getPl(id, tx);
      if (!cur) throw notFound('Packing list');
      assertDraft(cur, 'Packing list');
      await this.validatePlCartons(input, tx, id);
      if (!(await repo.updatePl(tx, id, input.version, { docDate: toDbDate(input.docDate), orderId: input.orderId, remarks: input.remarks }))) throw versionConflict();
      await repo.detachCartons(tx, id);
      await repo.attachCartons(tx, id, input.cartonIds);
    });
    return this.getPl(id);
  },
  async removePl(id: string) {
    await withTx(async (tx) => {
      await repo.lockPl(tx, id);
      const cur = await repo.getPl(id, tx);
      if (!cur) throw notFound('Packing list');
      assertDraft(cur, 'Packing list');
      await repo.detachCartons(tx, id);
      await repo.deletePl(tx, id);
    });
  },
  async postPl(id: string, user: CurrentUser) {
    await withTx(async (tx) => {
      await repo.lockPl(tx, id);
      const pl = await repo.getPl(id, tx);
      if (!pl) throw notFound('Packing list');
      assertDraft(pl, 'Packing list');
      if (!pl.cartons.length) throw new AppError('VALIDATION_ERROR', 'The packing list has no cartons', 400);
      const { docNo } = await numbering.next('PACKING_LIST', dateOnly(pl.docDate)!, tx);
      await repo.setPlState(tx, id, { status: 'POSTED', docNo, postedAt: new Date(), postedById: user.id });
      await audit.log(tx, { docType: 'PACKING_LIST', recordId: id, action: 'POST', docNo });
    });
    return this.getPl(id);
  },
  async cancelPl(id: string, reason: string) {
    await withTx(async (tx) => {
      await repo.lockPl(tx, id);
      const pl = await repo.getPl(id, tx);
      if (!pl) throw notFound('Packing list');
      assertPosted(pl, 'cancelled', 'Packing list');
      if (pl.exportInvoiceId) throw new AppError('DOC_HAS_DEPENDENTS', 'An export invoice has been raised from this packing list; cancel it first', 409);
      await repo.detachCartons(tx, id);
      await repo.setPlState(tx, id, { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason });
      await audit.log(tx, { docType: 'PACKING_LIST', recordId: id, action: 'CANCEL', reason, docNo: pl.docNo });
    });
    return this.getPl(id);
  },
  /** For export (Step 11): mark / unmark a posted packing list as invoiced. */
  async setInvoiced(tx: Tx, id: string, exportInvoiceId: string | null) {
    await repo.lockPl(tx, id);
    const pl = await repo.getPl(id, tx);
    if (!pl) throw notFound('Packing list');
    if (exportInvoiceId && pl.status !== 'POSTED') throw new AppError('INVALID_STATE', `Packing list ${pl.docNo ?? ''} is not posted`, 409);
    if (exportInvoiceId && pl.exportInvoiceId && pl.exportInvoiceId !== exportInvoiceId) throw new AppError('ALREADY_BILLED', `Packing list ${pl.docNo} is already invoiced`, 409);
    await repo.setPlState(tx, id, { exportInvoiceId });
    return shapePl(pl);
  },
};
