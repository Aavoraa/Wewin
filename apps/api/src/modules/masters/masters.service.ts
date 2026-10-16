import { Prisma } from '@wewin/db';
import { type z } from 'zod';
import {
  type SystemLocationCode,
  type zBuyerInput,
  type zItemInput,
  type zItemListQuery,
  type zLocationListQuery,
  type zMasterListQuery,
  type zProcessInput,
  type zVendorInput,
  type zVendorListQuery,
} from '@wewin/shared';
import { type Tx, prisma, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { activeFilter, codeNameSearch, orderBy, paging } from '../../core/list';
import { mastersRepo as repo } from './masters.repo';

type VendorData = z.output<typeof zVendorInput>;
const RC = { isolation: 'ReadCommitted' } as const;

function dec(v: string | null | undefined) {
  return v ? new Prisma.Decimal(v) : null;
}

function vendorFields(v: VendorData) {
  const { processIds: _p, code: _c, tdsRatePct, debitNoteGstRatePct, ...rest } = v;
  return { ...rest, tdsRatePct: dec(tdsRatePct), debitNoteGstRatePct: dec(debitNoteGstRatePct) };
}

export const mastersService = {
  // ───────── Processes ─────────
  async listProcesses(q: z.output<typeof zMasterListQuery>) {
    const p = paging(q);
    const where: Prisma.ProcessWhereInput = { ...activeFilter(q.active), ...codeNameSearch(q.q) };
    const [rows, total] = await repo.listProcesses(
      where,
      orderBy<Prisma.ProcessOrderByWithRelationInput>(q.sort, { code: (d) => ({ code: d }), name: (d) => ({ name: d }) }, { code: 'asc' }),
      p,
    );
    return { rows, total, p };
  },
  createProcess(input: z.output<typeof zProcessInput>) {
    return withTx((tx) => repo.createProcess(tx, input), RC);
  },
  async updateProcess(id: string, input: z.output<typeof zProcessInput> & { version: number }) {
    return withTx(async (tx) => {
      const cur = await repo.getProcess(id, tx);
      if (!cur) throw notFound('Process');
      if (cur.code !== input.code) throw new AppError('VALIDATION_ERROR', 'Process code cannot be changed', 400);
      const { version, code: _c, ...data } = input;
      const r = await repo.updateProcess(tx, id, version, data);
      if (r.count === 0) throw versionConflict();
      return repo.getProcess(id, tx);
    }, RC);
  },
  setProcessActive(id: string, isActive: boolean) {
    return withTx(async (tx) => {
      if (!(await repo.getProcess(id, tx))) throw notFound('Process');
      return repo.setProcessActive(tx, id, isActive);
    }, RC);
  },
  async processByCode(code: string, tx: Tx | typeof prisma = prisma) {
    const p = await repo.processByCode(code, tx);
    if (!p) throw notFound(`Process ${code}`);
    return p;
  },

  // ───────── Vendors ─────────
  async listVendors(q: z.output<typeof zVendorListQuery>) {
    const p = paging(q);
    const where: Prisma.VendorWhereInput = {
      ...activeFilter(q.active),
      ...codeNameSearch(q.q),
      ...(q.processId ? { processes: { some: { processId: q.processId } } } : {}),
      ...(q.processCode ? { processes: { some: { process: { code: q.processCode } } } } : {}),
    };
    const [rows, total] = await repo.listVendors(
      where,
      orderBy<Prisma.VendorOrderByWithRelationInput>(
        q.sort,
        { code: (d) => ({ code: d }), name: (d) => ({ name: d }), city: (d) => ({ city: d }), creditDays: (d) => ({ creditDays: d }) },
        { name: 'asc' },
      ),
      p,
    );
    return { rows: rows.map(shapeVendor), total, p };
  },

  async getVendor(id: string) {
    const v = await repo.getVendor(id);
    if (!v) throw notFound('Vendor');
    const loc = await repo.vendorLocation(prisma, id);
    return { ...shapeVendor(v), locationId: loc?.id ?? null };
  },

  /** Creates the vendor AND its stock location in one transaction (B-Step 2). */
  async createVendor(input: VendorData) {
    return withTx(async (tx) => {
      if (input.processIds.length && (await repo.countProcesses(input.processIds)) !== input.processIds.length) {
        throw new AppError('VALIDATION_ERROR', 'Unknown process selected', 400);
      }
      const v = await repo.createVendor(tx, { code: input.code, ...vendorFields(input) });
      await repo.createVendorLocation(tx, v.id, `V-${v.code}`, v.name);
      if (input.processIds.length) await repo.setVendorProcesses(tx, v.id, input.processIds);
      return v;
    }, RC);
  },

  async updateVendor(id: string, input: VendorData & { version: number }) {
    return withTx(async (tx) => {
      const cur = await repo.getVendor(id, tx);
      if (!cur) throw notFound('Vendor');
      if (cur.code !== input.code) throw new AppError('VALIDATION_ERROR', 'Vendor code cannot be changed (it identifies the stock location)', 400);
      const r = await repo.updateVendor(tx, id, input.version, vendorFields(input));
      if (r.count === 0) throw versionConflict();
      await repo.setVendorProcesses(tx, id, input.processIds);
      if (cur.name !== input.name) await repo.renameVendorLocation(tx, id, input.name);
      return repo.getVendor(id, tx);
    }, RC);
  },

  setVendorActive(id: string, isActive: boolean) {
    return withTx(async (tx) => {
      if (!(await repo.getVendor(id, tx))) throw notFound('Vendor');
      // The vendor's stock location stays active so material already there can still return.
      return repo.setVendorActive(tx, id, isActive);
    }, RC);
  },

  /** Stock location of a vendor (every vendor is a location). Used by job-work services. */
  async vendorLocationId(vendorId: string, tx: Tx | typeof prisma = prisma): Promise<string> {
    const loc = await repo.vendorLocation(tx, vendorId);
    if (!loc) throw new AppError('INVALID_STATE', 'Vendor has no stock location', 409);
    return loc.id;
  },

  vendorsForMatching: () => repo.vendorsForMatching(),
  itemsForMatching: (types: ('YARN' | 'TRIM' | 'FABRIC' | 'PANEL' | 'GARMENT')[]) => repo.itemsForMatching(types),
  itemsByIdsBrief: (ids: string[]) => repo.itemsByIdsBrief(ids),

  async vendorById(id: string, tx: Tx | typeof prisma = prisma) {
    const v = await repo.getVendor(id, tx);
    if (!v) throw notFound('Vendor');
    return v;
  },

  // ───────── Buyers ─────────
  async listBuyers(q: z.output<typeof zMasterListQuery>) {
    const p = paging(q);
    const where: Prisma.BuyerWhereInput = { ...activeFilter(q.active), ...codeNameSearch(q.q) };
    const [rows, total] = await repo.listBuyers(
      where,
      orderBy<Prisma.BuyerOrderByWithRelationInput>(q.sort, { code: (d) => ({ code: d }), name: (d) => ({ name: d }), country: (d) => ({ country: d }) }, { name: 'asc' }),
      p,
    );
    return { rows, total, p };
  },
  async getBuyer(id: string) {
    const b = await repo.getBuyer(id);
    if (!b) throw notFound('Buyer');
    return b;
  },
  createBuyer(input: z.output<typeof zBuyerInput>) {
    return withTx((tx) => repo.createBuyer(tx, input), RC);
  },
  updateBuyer(id: string, input: z.output<typeof zBuyerInput> & { version: number }) {
    return withTx(async (tx) => {
      const cur = await repo.getBuyer(id, tx);
      if (!cur) throw notFound('Buyer');
      if (cur.code !== input.code) throw new AppError('VALIDATION_ERROR', 'Buyer code cannot be changed', 400);
      const { version, code: _c, ...data } = input;
      const r = await repo.updateBuyer(tx, id, version, data);
      if (r.count === 0) throw versionConflict();
      return repo.getBuyer(id, tx);
    }, RC);
  },
  setBuyerActive(id: string, isActive: boolean) {
    return withTx(async (tx) => {
      if (!(await repo.getBuyer(id, tx))) throw notFound('Buyer');
      return repo.setBuyerActive(tx, id, isActive);
    }, RC);
  },

  // ───────── Items ─────────
  async listItems(q: z.output<typeof zItemListQuery>) {
    const p = paging(q);
    const where: Prisma.ItemWhereInput = { ...activeFilter(q.active), ...codeNameSearch(q.q), ...(q.type ? { type: q.type } : {}) };
    const [rows, total] = await repo.listItems(
      where,
      orderBy<Prisma.ItemOrderByWithRelationInput>(q.sort, { code: (d) => ({ code: d }), name: (d) => ({ name: d }), type: (d) => ({ type: d }) }, { code: 'asc' }),
      p,
    );
    return { rows, total, p };
  },
  async getItem(id: string) {
    const i = await repo.getItem(id);
    if (!i) throw notFound('Item');
    return i;
  },
  createItem(input: z.output<typeof zItemInput>) {
    return withTx((tx) => repo.createItem(tx, input), RC);
  },
  updateItem(id: string, input: z.output<typeof zItemInput> & { version: number }) {
    return withTx(async (tx) => {
      const cur = await repo.getItem(id, tx);
      if (!cur) throw notFound('Item');
      const used = (await repo.itemHasMovements(tx, id)) > 0;
      if (used && (cur.code !== input.code || cur.unit !== input.unit || cur.type !== input.type)) {
        throw new AppError('INVALID_STATE', 'Code, type and unit cannot change once the item has stock movements', 409);
      }
      const { version, ...data } = input;
      const r = await repo.updateItem(tx, id, version, data);
      if (r.count === 0) throw versionConflict();
      return repo.getItem(id, tx);
    }, RC);
  },
  setItemActive(id: string, isActive: boolean) {
    return withTx(async (tx) => {
      if (!(await repo.getItem(id, tx))) throw notFound('Item');
      return repo.setItemActive(tx, id, isActive);
    }, RC);
  },
  async itemById(id: string, tx: Tx | typeof prisma = prisma) {
    const i = await repo.getItem(id, tx);
    if (!i) throw notFound('Item');
    return i;
  },

  // ───────── Locations ─────────
  async listLocations(q: z.output<typeof zLocationListQuery>) {
    const p = paging(q);
    const where: Prisma.LocationWhereInput = { ...activeFilter(q.active), ...codeNameSearch(q.q), ...(q.kind ? { kind: q.kind } : {}) };
    const [rows, total] = await repo.listLocations(
      where,
      orderBy<Prisma.LocationOrderByWithRelationInput>(q.sort, { code: (d) => ({ code: d }), name: (d) => ({ name: d }), kind: (d) => ({ kind: d }) }, { name: 'asc' }),
      p,
    );
    return { rows, total, p };
  },

  /** Resolve own/virtual system locations by code (YARN_STORE, CONSUMED, …). */
  async systemLocations<K extends SystemLocationCode>(codes: K[], tx: Tx | typeof prisma = prisma): Promise<Record<K, string>> {
    const rows = await repo.locationsByCodes(codes, tx);
    const map = Object.fromEntries(rows.map((r) => [r.code, r.id])) as Record<K, string>;
    for (const c of codes) if (!map[c]) throw new AppError('INVALID_STATE', `System location ${c} missing — run the seed`, 500);
    return map;
  },

  async locationById(id: string, tx: Tx | typeof prisma = prisma) {
    const l = await repo.getLocation(id, tx);
    if (!l) throw notFound('Location');
    return l;
  },
};

function shapeVendor<T extends { processes: { process: { id: string; code: string; name: string } }[] }>(v: T) {
  const { processes, ...rest } = v;
  return { ...rest, processes: processes.map((p) => p.process), processIds: processes.map((p) => p.process.id) };
}

export type { VendorData };
