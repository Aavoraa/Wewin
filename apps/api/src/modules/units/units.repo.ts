import { type Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';

const unitSelect = { id: true, code: true, name: true, exporterId: true, docPrefix: true, isActive: true, version: true } satisfies Prisma.BusinessUnitSelect;

type ExporterData = Omit<Prisma.ExporterUncheckedCreateInput, 'id' | 'code' | 'version' | 'createdAt' | 'updatedAt' | 'units'>;

/** Prisma queries for exporters, units and which users may use them (Q-085). No business rules here. */
export const unitsRepo = {
  listExporters() {
    return prisma.exporter.findMany({ orderBy: { code: 'asc' }, include: { units: { select: unitSelect, orderBy: { code: 'asc' } } } });
  },
  getExporter(id: string, tx: Tx | typeof prisma = prisma) {
    return tx.exporter.findUnique({ where: { id } });
  },
  createExporter(tx: Tx, data: ExporterData & { code: string }) {
    return tx.exporter.create({ data });
  },
  async updateExporter(tx: Tx, id: string, version: number, data: ExporterData) {
    const r = await tx.exporter.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
    return r.count === 0 ? null : tx.exporter.findUniqueOrThrow({ where: { id } });
  },
  setExporterActive(tx: Tx, id: string, isActive: boolean) {
    return tx.exporter.update({ where: { id }, data: { isActive, version: { increment: 1 } } });
  },
  /** The first exporter's details are also the company settings row older code reads. */
  mirrorCompany(tx: Tx, data: Prisma.CompanySettingsUpdateManyMutationInput) {
    return tx.companySettings.updateMany({ where: { id: 1 }, data: { ...data, version: { increment: 1 } } });
  },

  getUnit(id: string, tx: Tx | typeof prisma = prisma) {
    return tx.businessUnit.findUnique({ where: { id }, select: { ...unitSelect, exporter: true } });
  },
  unitByPrefix(tx: Tx, docPrefix: string) {
    return tx.businessUnit.findFirst({ where: { docPrefix }, select: { id: true } });
  },
  createUnit(tx: Tx, data: { code: string; name: string; exporterId: string; docPrefix: string }) {
    return tx.businessUnit.create({ data, select: unitSelect });
  },
  async updateUnit(tx: Tx, id: string, version: number, name: string) {
    const r = await tx.businessUnit.updateMany({ where: { id, version }, data: { name, version: { increment: 1 } } });
    return r.count === 0 ? null : tx.businessUnit.findUniqueOrThrow({ where: { id }, select: unitSelect });
  },
  setUnitActive(tx: Tx, id: string, isActive: boolean) {
    return tx.businessUnit.update({ where: { id }, data: { isActive, version: { increment: 1 } }, select: unitSelect });
  },
};
