import { type Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';

const select = { id: true, reportKey: true, params: true, status: true, fileName: true, rowCount: true, error: true, createdAt: true, completedAt: true, requestedById: true, fileKey: true } satisfies Prisma.ReportExportSelect;

export const reportExportsRepo = {
  create(tx: Tx, data: Prisma.ReportExportUncheckedCreateInput) {
    return tx.reportExport.create({ data, select: { id: true } });
  },
  get(id: string) {
    return prisma.reportExport.findUnique({ where: { id }, select });
  },
  /** QUEUED → RUNNING once (idempotent job). */
  async claim(id: string) {
    const r = await prisma.reportExport.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
    return r.count === 1 ? prisma.reportExport.findUnique({ where: { id } }) : null;
  },
  update(tx: Tx, id: string, data: Prisma.ReportExportUncheckedUpdateInput) {
    return tx.reportExport.update({ where: { id }, data });
  },
  mine(userId: string) {
    return prisma.reportExport.findMany({ where: { requestedById: userId }, orderBy: { createdAt: 'desc' }, take: 30, select });
  },
  olderThan(before: Date) {
    return prisma.reportExport.findMany({ where: { createdAt: { lt: before }, fileKey: { not: null } }, select: { id: true, fileKey: true } });
  },
  clearFiles(ids: string[]) {
    return prisma.reportExport.updateMany({ where: { id: { in: ids } }, data: { fileKey: null } });
  },
};
