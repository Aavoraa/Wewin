import { type Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

export const alertsRepo = {
  list(where: Prisma.AlertWhereInput, p: Paging) {
    return prisma.$transaction([
      prisma.alert.findMany({ where, orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }], skip: p.skip, take: p.take }),
      prisma.alert.count({ where }),
    ]);
  },
  get(id: string, db: Tx | typeof prisma = prisma) {
    return db.alert.findUnique({ where: { id } });
  },
  openOfKind(tx: Tx, kind: string) {
    return tx.alert.findMany({ where: { kind, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } } });
  },
  create(tx: Tx, data: Prisma.AlertUncheckedCreateInput) {
    return tx.alert.create({ data });
  },
  touch(tx: Tx, id: string, data: Prisma.AlertUncheckedUpdateInput) {
    return tx.alert.update({ where: { id }, data: { ...data, lastSeenAt: new Date() } });
  },
  resolve(tx: Tx, ids: string[]) {
    return tx.alert.updateMany({ where: { id: { in: ids } }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
  },
  acknowledge(tx: Tx, id: string, userId: string) {
    return tx.alert.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'ACKNOWLEDGED', acknowledgedById: userId, acknowledgedAt: new Date() } });
  },
  counts() {
    return prisma.alert.groupBy({ by: ['kind', 'severity'], where: { status: 'ACTIVE' }, _count: { _all: true } });
  },
};
