import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import {
  type zProgramInput,
  type zProgramListQuery,
  type zProgramUpdate,
  type zTrimsBomInput,
  programPlan,
  trimsRequirement,
} from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, invalidState, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { type CurrentUser } from '../../core/auth/auth.types';
import { ordersService } from '../orders/orders.service';
import { type ProgramDetail, type ProcessRowData, programsRepo as repo } from './programs.repo';

const RC = { isolation: 'ReadCommitted' } as const;
type ProcessInput = z.output<typeof zProgramInput>['processes'][number];

/** Hook set by the job-work module: counts D.C.s that reference a program (dependency check). */
let dcReferenceCounter: ((programId: string, tx: Tx) => Promise<number>) | null = null;
export function registerProgramDependencyCounter(fn: (programId: string, tx: Tx) => Promise<number>) {
  dcReferenceCounter = fn;
}

function shape(p: ProgramDetail) {
  const plan = programPlan(
    p.requiredKg.toString(),
    p.processes.map((x) => ({ sequence: x.sequence, allowedLossPct: x.allowedLossPct.toString() })),
  );
  return {
    ...p,
    requiredKg: p.requiredKg.toFixed(3),
    processes: p.processes.map((x) => ({
      ...x,
      allowedLossPct: x.allowedLossPct.toString(),
      materialCostPerKg: x.materialCostPerKg?.toString() ?? null,
      plannedInputKg: plan[x.sequence]?.inputKg ?? null,
      plannedOutputKg: plan[x.sequence]?.outputKg ?? null,
    })),
  };
}

async function validateRows(fabricItemId: string, processes: ProcessInput[]) {
  const itemIds = [fabricItemId, ...processes.flatMap((p) => [p.inputItemId, p.outputItemId])];
  const items = new Map((await repo.itemsByIds(itemIds)).map((i) => [i.id, i]));
  if (items.get(fabricItemId)?.type !== 'FABRIC') throw new AppError('VALIDATION_ERROR', 'Program fabric must be a FABRIC item', 400);
  for (const p of processes) {
    for (const id of [p.inputItemId, p.outputItemId]) {
      const t = items.get(id)?.type;
      if (t !== 'YARN' && t !== 'FABRIC') throw new AppError('VALIDATION_ERROR', `Process ${p.sequence}: items must be yarn or fabric`, 400);
    }
  }
  const procs = new Map((await repo.processesByIds(processes.map((p) => p.processId))).map((p) => [p.id, p]));
  for (const p of processes) {
    const pr = procs.get(p.processId);
    if (!pr) throw new AppError('VALIDATION_ERROR', `Process ${p.sequence}: unknown process`, 400);
    if (pr.stage !== 'KG') throw new AppError('VALIDATION_ERROR', `Process ${pr.code} is a piece-stage process; fabric programs use kilo-stage processes`, 400);
  }
}

const rows = (ps: ProcessInput[]): ProcessRowData[] =>
  ps.map((p) => ({
    sequence: p.sequence,
    processId: p.processId,
    inputItemId: p.inputItemId,
    outputItemId: p.outputItemId,
    allowedLossPct: p.allowedLossPct,
    materialCostPerKg: p.materialCostPerKg,
    plannedVendorId: p.plannedVendorId,
  }));

export const programsService = {
  async list(q: z.output<typeof zProgramListQuery>) {
    const p = paging(q);
    const where: Prisma.FabricProgramWhereInput = {
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? {
            OR: [
              { programNo: { contains: q.q, mode: 'insensitive' } },
              { order: { orderNo: { contains: q.q, mode: 'insensitive' } } },
              { fabricItem: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [list, total] = await repo.list(
      where,
      orderBy<Prisma.FabricProgramOrderByWithRelationInput>(q.sort, { programNo: (d) => ({ programNo: d }), createdAt: (d) => ({ createdAt: d }) }, { createdAt: 'desc' }),
      p,
    );
    return { rows: list.map(shape), total, p };
  },

  async get(id: string) {
    const p = await repo.get(id);
    if (!p) throw notFound('Fabric program');
    return shape(p);
  },

  async create(input: z.output<typeof zProgramInput>) {
    await validateRows(input.fabricItemId, input.processes);
    return withTx(async (tx) => {
      const order = await ordersService.requireOpen(input.orderId, tx);
      const n = (await repo.countForOrder(tx, order.id)) + 1;
      const created = await repo.create(
        tx,
        {
          programNo: `${order.orderNo}/P${n}`,
          orderId: order.id,
          fabricItemId: input.fabricItemId,
          colour: input.colour,
          requiredKg: input.requiredKg,
          gsm: input.gsm,
          dia: input.dia,
          remarks: input.remarks,
        },
        rows(input.processes),
      );
      return shape((await repo.get(created.id, tx))!);
    });
  },

  async update(id: string, input: z.output<typeof zProgramUpdate>) {
    await validateRows(input.fabricItemId, input.processes);
    return withTx(async (tx) => {
      const cur = await repo.getForUpdate(tx, id);
      if (!cur) throw notFound('Fabric program');
      if (cur.status !== 'DRAFT') throw invalidState('Only a draft program can be edited; approved loss limits are locked');
      const ok = await repo.update(
        tx,
        id,
        input.version,
        { fabricItemId: input.fabricItemId, colour: input.colour, requiredKg: input.requiredKg, gsm: input.gsm, dia: input.dia, remarks: input.remarks },
        rows(input.processes),
      );
      if (!ok) throw versionConflict();
      return shape((await repo.get(id, tx))!);
    }, RC);
  },

  async approve(id: string, user: CurrentUser) {
    return withTx(async (tx) => {
      const p = await repo.getForUpdate(tx, id);
      if (!p) throw notFound('Fabric program');
      if (p.status !== 'DRAFT') throw invalidState(`Only a draft program can be approved (it is ${p.status.toLowerCase()})`);
      await ordersService.requireOpen(p.orderId, tx);
      await repo.setStatus(tx, id, { status: 'APPROVED', approvedAt: new Date(), approvedById: user.id });
      await audit.log(tx, { docType: 'FABRIC_PROGRAM', recordId: id, action: 'APPROVE', docNo: p.programNo });
      return shape((await repo.get(id, tx))!);
    });
  },

  async cancel(id: string, reason: string) {
    return withTx(async (tx) => {
      const p = await repo.getForUpdate(tx, id);
      if (!p) throw notFound('Fabric program');
      if (p.status === 'CANCELLED') throw invalidState('Program is already cancelled');
      if (dcReferenceCounter && (await dcReferenceCounter(id, tx)) > 0) {
        throw new AppError('DOC_HAS_DEPENDENTS', 'Delivery challans reference this program; cancel them first', 409);
      }
      await repo.setStatus(tx, id, { status: 'CANCELLED' });
      await audit.log(tx, { docType: 'FABRIC_PROGRAM', recordId: id, action: 'CANCEL', reason, docNo: p.programNo });
      return shape((await repo.get(id, tx))!);
    });
  },

  async deleteDraft(id: string) {
    return withTx(async (tx) => {
      const p = await repo.getForUpdate(tx, id);
      if (!p) throw notFound('Fabric program');
      if (p.status !== 'DRAFT') throw invalidState('Only draft programs can be deleted');
      await repo.delete(tx, id);
    }, RC);
  },

  /**
   * For job work: the program process an outward D.C. is sent under. The program must be APPROVED,
   * so the allowed loss % used in calculations cannot change afterwards.
   */
  /** Program processes an outward D.C. for this order + process could go under (approved programs only). */
  approvedProcessesFor(orderId: string, processId: string, db: Tx | typeof prisma = prisma) {
    return repo.approvedProcesses(orderId, processId, db);
  },

  async processForDc(programProcessId: string, db: Tx | typeof prisma = prisma) {
    const row = await repo.processRow(programProcessId, db);
    if (!row) throw notFound('Program process');
    if (row.program.status !== 'APPROVED') throw invalidState(`Program ${row.program.programNo} is not approved`);
    return {
      id: row.id,
      programId: row.program.id,
      programNo: row.program.programNo,
      orderId: row.program.orderId,
      processId: row.processId,
      processCode: row.process.code,
      inputItemId: row.inputItemId,
      outputItemId: row.outputItemId,
      allowedLossPct: row.allowedLossPct.toString(),
      materialCostPerKg: row.materialCostPerKg?.toString() ?? null,
    };
  },

  // ── Trims BOM ──
  async getBom(orderId: string) {
    const o = await ordersService.getDetail(orderId);
    const lines = await repo.bom(orderId);
    const matrix = o.lines.map((l) => ({ colour: l.colour, size: l.size, qty: l.qty }));
    return lines.map((l) => ({
      ...l,
      qtyPerGarment: l.qtyPerGarment.toString(),
      wastagePct: l.wastagePct.toString(),
      requirement: trimsRequirement({ colour: l.colour, size: l.size, qtyPerGarment: l.qtyPerGarment.toString(), wastagePct: l.wastagePct.toString() }, matrix),
    }));
  },

  async saveBom(orderId: string, input: z.output<typeof zTrimsBomInput>) {
    const items = new Map((await repo.itemsByIds(input.lines.map((l) => l.trimItemId))).map((i) => [i.id, i]));
    for (const l of input.lines) {
      if (items.get(l.trimItemId)?.type !== 'TRIM') throw new AppError('VALIDATION_ERROR', 'Trims BOM lines must use TRIM items', 400);
    }
    await withTx(async (tx) => {
      const o = await ordersService.requireOpen(orderId, tx);
      for (const l of input.lines) {
        if (l.colour && !o.colours.includes(l.colour)) throw new AppError('VALIDATION_ERROR', `Colour ${l.colour} is not on the order`, 400);
        if (l.size && !o.sizes.includes(l.size)) throw new AppError('VALIDATION_ERROR', `Size ${l.size} is not on the order`, 400);
      }
      await repo.replaceBom(tx, orderId, input.lines);
    }, RC);
    return this.getBom(orderId);
  },
};
