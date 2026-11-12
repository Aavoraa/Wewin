import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import {
  type zProgramInput,
  type zProgramListQuery,
  type zProgramUpdate,
  type zTrimsBomInput,
  type Dec,
  type YarnMixLine,
  D,
  accessoryQtyDetails,
  programMissing,
  programPlan,
  programYarnNeed,
  trimsRequirement,
} from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, invalidState, notFound, versionConflict } from '../../core/errors/app-error';
import { orderBy, paging } from '../../core/list';
import { audit } from '../../core/audit/audit.service';
import { type CurrentUser } from '../../core/auth/auth.types';
import { ordersService } from '../orders/orders.service';
import { type ProgramDetail, type ProcessRowData, type ProgramSpecData, programsRepo as repo } from './programs.repo';

const RC = { isolation: 'ReadCommitted' } as const;
type ProcessInput = z.output<typeof zProgramInput>['processes'][number];

/** Hook set by the job-work module: counts D.C.s that reference a program (dependency check). */
let dcReferenceCounter: ((programId: string, tx: Tx) => Promise<number>) | null = null;
/**
 * Scan invoices registers this (Q-068): a programme created from a Programme Entry screenshot marks
 * that scan as used, in the programme's transaction.
 */
type FromScanHook = (tx: Tx, programId: string, scanId: string, user: CurrentUser) => Promise<void>;
let fromScanHook: FromScanHook | null = null;
export function onProgramCreatedFromScan(h: FromScanHook) {
  fromScanHook = h;
}

export function registerProgramDependencyCounter(fn: (programId: string, tx: Tx) => Promise<number>) {
  dcReferenceCounter = fn;
}

function shape(p: ProgramDetail) {
  const plan = programPlan(
    p.requiredKg?.toString() ?? '0',
    p.processes.map((x) => ({ sequence: x.sequence, allowedLossPct: x.allowedLossPct.toString() })),
  );
  return {
    ...p,
    requiredKg: p.requiredKg?.toFixed(3) ?? null,
    missing: programMissing({ fabricItemId: p.fabricItemId, requiredKg: p.requiredKg?.toString() ?? null, processes: p.processes }),
    mtrToKg: p.mtrToKg?.toString() ?? null,
    processes: p.processes.map((x) => ({
      ...x,
      allowedLossPct: x.allowedLossPct.toString(),
      materialCostPerKg: x.materialCostPerKg?.toString() ?? null,
      plannedInputKg: plan[x.sequence]?.inputKg ?? null,
      plannedOutputKg: plan[x.sequence]?.outputKg ?? null,
    })),
  };
}

async function validateRows(fabricItemId: string | null, processes: ProcessInput[]) {
  const itemIds = [fabricItemId, ...processes.flatMap((p) => [p.inputItemId, p.outputItemId])].filter((x): x is string => !!x);
  const items = new Map((await repo.itemsByIds(itemIds)).map((i) => [i.id, i]));
  if (fabricItemId && items.get(fabricItemId)?.type !== 'FABRIC') throw new AppError('VALIDATION_ERROR', 'Program fabric must be a FABRIC item', 400);
  for (const p of processes) {
    for (const id of [p.inputItemId, p.outputItemId]) {
      if (!id) continue;
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

/** Programme entry fields (Q-067) from the input, blanks as null. */
function spec(input: Omit<z.output<typeof zProgramUpdate>, 'version'>): ProgramSpecData {
  return {
    portion: input.portion ?? null,
    printColour: input.printColour ?? null,
    fabricDescription: input.fabricDescription ?? null,
    fabricType: input.fabricType ?? null,
    greyGsm: input.greyGsm ?? null,
    gauge: input.gauge ?? null,
    loopLength: input.loopLength ?? null,
    uom: input.uom,
    mtrToKg: input.mtrToKg ?? null,
    collarCuffReqd: input.collarCuffReqd ?? null,
    withMeasurement: input.withMeasurement,
    measureUnit: input.measureUnit,
    tubSingle: input.tubSingle ?? null,
    processTemplate: input.processTemplate ?? null,
    yarnMix: input.yarnMix.map((l) => ({ yarnItemId: l.yarnItemId ?? null, counts: l.counts, colour: l.colour ?? null, consPct: l.consPct })),
    sizeSpecs: input.sizeSpecs.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v ?? null]))),
  };
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

  async create(input: z.output<typeof zProgramInput>, user?: CurrentUser) {
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
          sourceScanId: input.sourceScanId ?? null,
          ...spec(input),
        },
        rows(input.processes),
      );
      if (input.sourceScanId) {
        if (!fromScanHook || !user) throw new AppError('VALIDATION_ERROR', 'Scanned programmes cannot be created here', 400);
        await fromScanHook(tx, created.id, input.sourceScanId, user);
      }
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
        { fabricItemId: input.fabricItemId, colour: input.colour, requiredKg: input.requiredKg, gsm: input.gsm, dia: input.dia, remarks: input.remarks, ...spec(input) },
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
      const missing = programMissing({ fabricItemId: p.fabricItemId, requiredKg: p.requiredKg?.toString() ?? null, processes: p.processes });
      if (missing.length) throw new AppError('VALIDATION_ERROR', `Fill in before approving: ${missing.join(', ')}`, 400, { missing });
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

  bySourceScan: (scanId: string) => repo.bySourceScan(scanId),
  processTemplates: () => repo.processTemplates(),

  /** What a Programme Entry screenshot can be matched to: items used before for the same description / counts, and kilo-stage processes. */
  async scanMemory(fabricDescription: string, counts: string[]) {
    const [fabricItemId, yarns, processes] = await Promise.all([fabricDescription ? repo.fabricForDescription(fabricDescription) : null, repo.yarnsForCounts(counts), repo.activeKgProcesses()]);
    return { fabricItemId, yarns, processes };
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

  /**
   * Yarn an order needs (Q-073), from its approved fabric programmes, per yarn item × yarn colour.
   * Yarn-mix rows with no yarn item picked are returned with itemId null so the caller can name them.
   */
  async yarnRequirement(orderId: string) {
    const programs = await repo.approvedForYarn(orderId);
    const cells = new Map<string, { itemId: string | null; counts: string | null; colour: string | null; kg: Dec; programs: string[] }>();
    for (const p of programs) {
      const needs = programYarnNeed({
        requiredKg: p.requiredKg?.toString() ?? null,
        processes: p.processes.map((x) => ({ sequence: x.sequence, allowedLossPct: x.allowedLossPct.toString(), inputItemId: x.inputItemId, inputIsYarn: x.inputItem ? x.inputItem.type === 'YARN' : undefined })),
        yarnMix: Array.isArray(p.yarnMix) ? (p.yarnMix as unknown as YarnMixLine[]) : [],
      });
      for (const n of needs) {
        const key = `${n.yarnItemId ?? `?${n.counts ?? ''}`}|${(n.colour ?? '').toUpperCase()}`;
        const c = cells.get(key) ?? { itemId: n.yarnItemId, counts: n.counts, colour: n.colour, kg: D(0), programs: [] };
        c.kg = c.kg.plus(D(n.kg));
        if (!c.programs.includes(p.programNo)) c.programs.push(p.programNo);
        cells.set(key, c);
      }
    }
    const ids = [...new Set([...cells.values()].map((c) => c.itemId).filter((x): x is string => !!x))];
    const items = new Map((await repo.itemNames(ids)).map((i) => [i.id, i]));
    return [...cells.values()].map((c) => {
      const item = c.itemId ? items.get(c.itemId) : undefined;
      return { itemId: item?.type === 'YARN' ? item.id : null, item: item ? { code: item.code, name: item.name } : null, counts: c.counts, colour: c.colour, requiredKg: c.kg.toFixed(3), programs: c.programs };
    });
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
      qtyDetails: accessoryQtyDetails({ colour: l.colour, size: l.size, qtyPerGarment: l.qtyPerGarment.toString(), wastagePct: l.wastagePct.toString(), sizewise: l.sizewise, colourwise: l.colourwise }, matrix),
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

  /** Accessories Requirement "Copy" (Q-069): another order's requirement lines; colour / size limits the target order lacks are dropped. */
  async copyBom(orderId: string, fromOrderId: string) {
    if (orderId === fromOrderId) throw new AppError('VALIDATION_ERROR', 'Pick a different order to copy from', 400);
    const [target, source] = await Promise.all([ordersService.getDetail(orderId), repo.bom(fromOrderId)]);
    if (!source.length) throw new AppError('VALIDATION_ERROR', 'That order has no accessories requirement to copy', 400);
    return source.map((l) => ({
      trimItemId: l.trimItemId,
      trimItem: l.trimItem,
      colour: l.colour && target.colours.includes(l.colour) ? l.colour : null,
      size: l.size && target.sizes.includes(l.size) ? l.size : null,
      qtyPerGarment: l.qtyPerGarment.toString(),
      wastagePct: l.wastagePct.toString(),
      remarks: l.remarks,
      country: l.country,
      garDefine: l.garDefine,
      sizewise: l.sizewise,
      colourwise: l.colourwise,
      consumption: l.consumption,
    }));
  },
};
