import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { D, PROCESS_MATERIAL, isYarnProgramProcess, yarnProgramPlan, type zYarnProgramInput, type zYarnProgramListQuery, type zYarnProgramUpdate } from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, invalidState, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { type CurrentUser } from '../../core/auth/auth.types';
import { ordersService } from '../orders/orders.service';
import { type YarnProgramData, type YarnProgramDetail, yarnProgramsRepo as repo } from './yarnPrograms.repo';

const DOC = 'YARN_PROGRAM';
const RC = { isolation: 'ReadCommitted' } as const;
type Input = z.output<typeof zYarnProgramInput>;
type Update = z.output<typeof zYarnProgramUpdate>;

function shape(p: YarnProgramDetail) {
  const plan = yarnProgramPlan(p.requiredKg?.toString() ?? null, p.allowedLossPct.toString(), p.inputs.map((l) => ({ mixPct: l.mixPct.toString() })));
  return {
    ...p,
    requiredKg: p.requiredKg?.toFixed(3) ?? null,
    allowedLossPct: p.allowedLossPct.toString(),
    materialCostPerKg: p.materialCostPerKg?.toString() ?? null,
    sendKg: plan?.sendKg ?? null,
    inputs: p.inputs.map((l, n) => ({ ...l, mixPct: l.mixPct.toString(), planKg: plan?.inputs[n] ?? null })),
  };
}

const head = (v: Input | Update): YarnProgramData => ({
  outputItemId: v.outputItemId,
  outputColour: v.outputColour ?? null,
  requiredKg: v.requiredKg ?? null,
  allowedLossPct: v.allowedLossPct,
  materialCostPerKg: v.materialCostPerKg ?? null,
  remarks: v.remarks ?? null,
});
const inputs = (v: Input | Update) => v.inputs.map((l) => ({ itemId: l.itemId, colour: l.colour ?? null, mixPct: l.mixPct }));

/**
 * In and out must be active items of the process's material (yarn or fabric, PROCESS_MATERIAL);
 * a kilo process not on the Transaction screens takes yarn or fabric.
 */
async function validateItems(v: Input | Update, processCode: string, db: Tx | typeof prisma) {
  const ids = [v.outputItemId, ...v.inputs.map((l) => l.itemId)];
  const items = new Map((await repo.items(ids, db)).map((i) => [i.id, i]));
  const material = PROCESS_MATERIAL[processCode];
  const check = (id: string, want: 'YARN' | 'FABRIC' | undefined, what: string) => {
    const it = items.get(id);
    if (!it || !(want ? it.type === want : it.type === 'YARN' || it.type === 'FABRIC')) {
      throw new AppError('VALIDATION_ERROR', `${what} must be a ${want ? want.toLowerCase() : 'yarn or fabric'} item for ${processCode}`, 400);
    }
    if (!it.isActive) throw new AppError('VALIDATION_ERROR', `${what}: item ${it.code} is inactive`, 400);
  };
  check(v.outputItemId, material?.output, 'Out');
  v.inputs.forEach((l, n) => check(l.itemId, material?.input, `In, row ${n + 1}`));
}

export const yarnProgramsService = {
  async list(q: z.output<typeof zYarnProgramListQuery>) {
    const p = paging(q);
    const where: Prisma.YarnProgramWhereInput = {
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.processId ? { processId: q.processId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? {
            OR: [
              { programNo: { contains: q.q, mode: 'insensitive' } },
              { order: { orderNo: { contains: q.q, mode: 'insensitive' } } },
              { outputItem: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await repo.list(
      where,
      orderBy<Prisma.YarnProgramOrderByWithRelationInput>(q.sort, { programNo: (d) => ({ programNo: d }), createdAt: (d) => ({ createdAt: d }), status: (d) => ({ status: d }) }, { createdAt: 'desc' }),
      p,
    );
    return { rows: rows.map(shape), total, p };
  },

  async get(id: string) {
    const p = await repo.get(id);
    if (!p) throw notFound('Programme');
    return shape(p);
  },

  async create(input: Input) {
    const process = await repo.process(input.processId);
    if (!process || !process.isActive || process.stage !== 'KG') throw new AppError('VALIDATION_ERROR', 'Program Defined is for an active kilo process (Masters › Processes)', 400);
    await validateItems(input, process.code, prisma);
    return withTx(async (tx) => {
      const order = await ordersService.requireOpen(input.orderId, tx);
      const n = (await repo.countForOrder(tx, order.id)) + 1;
      // <order no>/Y<n> for the yarn processes, /PD<n> for the others; one count per order.
      const prefix = isYarnProgramProcess(process.code) ? 'Y' : 'PD';
      const created = await repo.create(tx, { ...head(input), programNo: `${order.orderNo}/${prefix}${n}`, orderId: order.id, processId: process.id }, inputs(input));
      return shape((await repo.get(created.id, tx))!);
    });
  },

  async update(id: string, input: Update) {
    return withTx(async (tx) => {
      const cur = await repo.getForUpdate(tx, id);
      if (!cur) throw notFound('Programme');
      await validateItems(input, cur.process.code, tx);
      if (cur.status !== 'DRAFT') throw invalidState('Only a draft programme can be edited; approved loss limits are locked');
      if (!(await repo.update(tx, id, input.version, head(input), inputs(input)))) throw versionConflict();
      return shape((await repo.get(id, tx))!);
    }, RC);
  },

  async approve(id: string, user: CurrentUser) {
    return withTx(async (tx) => {
      const p = await repo.getForUpdate(tx, id);
      if (!p) throw notFound('Programme');
      if (p.status !== 'DRAFT') throw invalidState(`Only a draft programme can be approved (it is ${p.status.toLowerCase()})`);
      if (!p.inputs.reduce((a, l) => a.plus(D(l.mixPct.toString())), D(0)).equals(100)) throw new AppError('VALIDATION_ERROR', 'Mixing % must add up to 100', 400);
      await ordersService.requireOpen(p.orderId, tx);
      await repo.setStatus(tx, id, { status: 'APPROVED', approvedAt: new Date(), approvedById: user.id });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'APPROVE', docNo: p.programNo });
      return shape((await repo.get(id, tx))!);
    });
  },

  async cancel(id: string, reason: string) {
    return withTx(async (tx) => {
      const p = await repo.getForUpdate(tx, id);
      if (!p) throw notFound('Programme');
      if (p.status === 'CANCELLED') throw invalidState('Programme is already cancelled');
      if ((await repo.outwardCount(tx, id)) > 0) throw new AppError('DOC_HAS_DEPENDENTS', 'Deliveries were made under this programme; cancel them first', 409);
      await repo.setStatus(tx, id, { status: 'CANCELLED' });
      await audit.log(tx, { docType: DOC, recordId: id, action: 'CANCEL', reason, docNo: p.programNo });
      return shape((await repo.get(id, tx))!);
    });
  },

  async deleteDraft(id: string) {
    await withTx(async (tx) => {
      const p = await repo.getForUpdate(tx, id);
      if (!p) throw notFound('Programme');
      if (p.status !== 'DRAFT') throw invalidState('Only draft programmes can be deleted');
      await repo.delete(tx, id);
    }, RC);
  },

  // ═════════ For job work ═════════
  /** The yarn programme an outward D.C. is sent under: approved, so its loss limit cannot change. */
  async forDc(id: string, db: Tx | typeof prisma = prisma) {
    const p = await repo.get(id, db);
    if (!p) throw notFound('Programme');
    if (p.status !== 'APPROVED') throw invalidState(`Programme ${p.programNo} is not approved`);
    return {
      id: p.id,
      programNo: p.programNo,
      orderId: p.orderId,
      processId: p.processId,
      processCode: p.process.code,
      allowedLossPct: p.allowedLossPct.toString(),
      inputItemIds: p.inputs.map((l) => l.itemId),
      outputItemId: p.outputItemId,
    };
  },
  /** Delivery picker options for a vendor (approved programmes of open orders for processes the vendor does). */
  async optionsForVendor(vendorId: string) {
    return (await repo.forVendor(vendorId)).map((p) => ({
      id: p.id,
      kind: 'YARN' as const,
      processId: p.processId,
      label: `${p.order.orderNo} · ${p.programNo} · ${p.process.name}: ${p.inputs.map((l) => `${l.item.name} ${D(l.mixPct.toString()).toString()}%`).join(' + ')} → ${p.outputItem.name}${p.outputColour ? ` ${p.outputColour}` : ''} — allowed loss ${D(p.allowedLossPct.toString()).toString()}%`,
      inputItemIds: p.inputs.map((l) => l.itemId),
    }));
  },
  approvedFor: (orderId: string, processId: string, db: Tx | typeof prisma = prisma) => repo.approvedFor(orderId, processId, db),
};
