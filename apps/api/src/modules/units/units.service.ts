import { type z } from 'zod';
import { type CompanySettingsInput, type ExporterCreateInput, type UnitCreateInput, type zUnitUpdate } from '@wewin/shared';
import { MAIN_UNIT_ID, withTx } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { invalidateAccessCache } from '../../core/auth/auth.middleware';
import { unitsRepo as repo } from './units.repo';

const RC = { isolation: 'ReadCommitted' } as const;

/** The first exporter (and its main unit) was created from the company settings and holds all older data. */
export const MAIN_EXPORTER_ID = MAIN_UNIT_ID;

function toDateOrNull(v: string | null | undefined): Date | null {
  return v ? new Date(`${v.slice(0, 10)}T00:00:00Z`) : null;
}

/** Exporter details as stored: blanks become null, LUT dates become dates. */
function exporterData(input: Omit<CompanySettingsInput, 'version'>) {
  const { lutValidFrom, lutValidTo, email, ...rest } = input;
  return {
    ...rest,
    tradeName: rest.tradeName || null,
    addressLine2: rest.addressLine2 || null,
    pan: rest.pan || null,
    phone: rest.phone || null,
    iec: rest.iec || null,
    lutNumber: rest.lutNumber || null,
    bankName: rest.bankName || null,
    bankAccount: rest.bankAccount || null,
    bankIfsc: rest.bankIfsc || null,
    email: email || null,
    lutValidFrom: toDateOrNull(lutValidFrom),
    lutValidTo: toDateOrNull(lutValidTo),
    isPlaceholder: false,
  };
}

export const unitsService = {
  /** Every exporter with its units, for the Exporters & Units master. */
  listExporters() {
    return repo.listExporters();
  },

  async createExporter(input: ExporterCreateInput) {
    const { code, ...rest } = input;
    return withTx(async (tx) => repo.createExporter(tx, { code, ...exporterData(rest) }), RC);
  },

  async updateExporter(id: string, input: CompanySettingsInput) {
    const { version, ...rest } = input;
    const data = exporterData(rest);
    const out = await withTx(async (tx) => {
      if (!(await repo.getExporter(id, tx))) throw notFound('Exporter');
      const e = await repo.updateExporter(tx, id, version, data);
      if (!e) throw versionConflict();
      if (id === MAIN_EXPORTER_ID) await repo.mirrorCompany(tx, data);
      return e;
    }, RC);
    invalidateAccessCache();
    return out;
  },

  async setExporterActive(id: string, isActive: boolean) {
    if (!isActive && id === MAIN_EXPORTER_ID) throw new AppError('INVALID_STATE', 'The first exporter holds the existing data and cannot be deactivated', 409);
    const out = await withTx(async (tx) => {
      if (!(await repo.getExporter(id, tx))) throw notFound('Exporter');
      return repo.setExporterActive(tx, id, isActive);
    }, RC);
    invalidateAccessCache();
    return out;
  },

  async createUnit(input: UnitCreateInput) {
    const out = await withTx(async (tx) => {
      const e = await repo.getExporter(input.exporterId, tx);
      if (!e) throw notFound('Exporter');
      if (await repo.unitByPrefix(tx, input.docPrefix)) throw new AppError('DUPLICATE', `Another unit already uses the number prefix ${input.docPrefix}`, 409);
      return repo.createUnit(tx, input);
    }, RC);
    invalidateAccessCache();
    return out;
  },

  async updateUnit(id: string, input: z.output<typeof zUnitUpdate>) {
    const out = await withTx(async (tx) => {
      if (!(await repo.getUnit(id, tx))) throw notFound('Unit');
      const u = await repo.updateUnit(tx, id, input.version, input.name);
      if (!u) throw versionConflict();
      return u;
    }, RC);
    invalidateAccessCache();
    return out;
  },

  async setUnitActive(id: string, isActive: boolean) {
    if (!isActive && id === MAIN_UNIT_ID) throw new AppError('INVALID_STATE', 'The main unit holds the existing data and cannot be deactivated', 409);
    const out = await withTx(async (tx) => {
      if (!(await repo.getUnit(id, tx))) throw notFound('Unit');
      return repo.setUnitActive(tx, id, isActive);
    }, RC);
    invalidateAccessCache();
    return out;
  },
};
