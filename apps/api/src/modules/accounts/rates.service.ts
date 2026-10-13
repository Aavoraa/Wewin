import { type Prisma } from '@wewin/db';
import { type z } from 'zod';
import { type zRateContractInput, type zRateListQuery } from '@wewin/shared';
import { withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { paging } from '../../core/list';
import { dateOnly, toDbDate } from '../../core/documents';
import { accountsRepo as repo } from './accounts.repo';

type Input = z.output<typeof zRateContractInput>;
const RC = { isolation: 'ReadCommitted' } as const;

/** Rate contracts per vendor + process (+ optional item / order) with an effective period (A§7.3). */
export const ratesService = {
  async list(q: z.output<typeof zRateListQuery>) {
    const p = paging(q);
    const where: Prisma.RateContractWhereInput = {
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.processId ? { processId: q.processId } : {}),
      ...(q.active === 'all' ? {} : { isActive: q.active !== 'false' }),
      ...(q.q ? { OR: [{ vendor: { name: { contains: q.q, mode: 'insensitive' } } }, { process: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await repo.listRates(where, p);
    return {
      rows: rows.map((r) => ({ ...r, rate: r.rate.toString(), effectiveFrom: dateOnly(r.effectiveFrom), effectiveTo: dateOnly(r.effectiveTo) })),
      total,
      p,
    };
  },

  async get(id: string) {
    const r = await repo.getRate(id);
    if (!r) throw notFound('Rate contract');
    return { ...r, rate: r.rate.toString(), effectiveFrom: dateOnly(r.effectiveFrom), effectiveTo: dateOnly(r.effectiveTo) };
  },

  async create(input: Input) {
    const id = await withTx(async (tx) => {
      await assertNoOverlap(tx, input);
      return (await repo.createRate(tx, data(input))).id;
    });
    return this.get(id);
  },

  /** Editing a rate changes the expected amount of future matches only; posted bills keep their stored rate. */
  async update(id: string, input: Input & { version: number }) {
    await withTx(async (tx) => {
      await assertNoOverlap(tx, input, id);
      if (!(await repo.updateRate(tx, id, input.version, data(input)))) throw versionConflict();
    });
    return this.get(id);
  },

  async setActive(id: string, isActive: boolean) {
    await withTx(async (tx) => {
      const r = await repo.getRate(id, tx);
      if (!r) throw notFound('Rate contract');
      if (isActive) {
        await assertNoOverlap(tx, { vendorId: r.vendorId, processId: r.processId, itemId: r.itemId, orderId: r.orderId, effectiveFrom: dateOnly(r.effectiveFrom)!, effectiveTo: dateOnly(r.effectiveTo) }, id);
      }
      await repo.setRateActive(tx, id, isActive);
    }, RC);
    return this.get(id);
  },
};

function data(i: Input) {
  return {
    vendorId: i.vendorId,
    processId: i.processId,
    itemId: i.itemId,
    orderId: i.orderId,
    unit: i.unit,
    rate: i.rate,
    effectiveFrom: toDbDate(i.effectiveFrom),
    effectiveTo: i.effectiveTo ? toDbDate(i.effectiveTo) : null,
    remarks: i.remarks,
  };
}

/** Two active contracts with the same scope may not overlap — the effective rate must be unambiguous. */
async function assertNoOverlap(
  tx: Parameters<typeof repo.overlapping>[0],
  i: Pick<Input, 'vendorId' | 'processId' | 'itemId' | 'orderId' | 'effectiveFrom' | 'effectiveTo'>,
  id?: string,
) {
  const clash = await repo.overlapping(tx, {
    id,
    vendorId: i.vendorId,
    processId: i.processId,
    itemId: i.itemId ?? null,
    orderId: i.orderId ?? null,
    from: toDbDate(i.effectiveFrom),
    to: i.effectiveTo ? toDbDate(i.effectiveTo) : null,
  });
  if (clash) {
    throw new AppError('VALIDATION_ERROR', `Overlaps the contract effective from ${dateOnly(clash.effectiveFrom)}; end that one first`, 409, { fieldErrors: { effectiveFrom: ['Overlaps an existing contract'] } });
  }
}
