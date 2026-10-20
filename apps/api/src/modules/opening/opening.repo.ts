import { type Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

/** Prisma queries for opening-data imports. No business rules. */
export const openingRepo = {
  list(where: Prisma.OpeningImportWhereInput, p: Paging) {
    return prisma.$transaction([
      prisma.openingImport.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, omit: { rows: true } }),
      prisma.openingImport.count({ where }),
    ]);
  },
  get(id: string, db: Tx | typeof prisma = prisma) {
    return db.openingImport.findUnique({ where: { id } });
  },
  lock(tx: Tx, id: string) {
    return tx.$queryRaw`SELECT id FROM opening_imports WHERE id = ${id}::uuid FOR UPDATE`;
  },
  create(tx: Tx, data: Prisma.OpeningImportUncheckedCreateInput) {
    return tx.openingImport.create({ data, select: { id: true } });
  },
  setState(tx: Tx, id: string, data: Prisma.OpeningImportUncheckedUpdateInput) {
    return tx.openingImport.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  remove(tx: Tx, id: string) {
    return tx.openingImport.delete({ where: { id } });
  },
};
