import { type Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

const issueInclude = {
  order: { select: { id: true, orderNo: true, styleNo: true } },
  lines: { orderBy: { lineNo: 'asc' }, include: { bundle: { select: { id: true, bundleNo: true, componentCode: true, colour: true, size: true, panelItemId: true, panelItem: { select: { name: true } } } } } },
} satisfies Prisma.SewingIssueInclude;
export type SewingIssueDetail = Prisma.SewingIssueGetPayload<{ include: typeof issueInclude }>;

const entryInclude = {
  order: { select: { id: true, orderNo: true, styleNo: true } },
  lines: { orderBy: { lineNo: 'asc' } },
} satisfies Prisma.SewingEntryInclude;
export type SewingEntryDetail = Prisma.SewingEntryGetPayload<{ include: typeof entryInclude }>;

export const sewingRepo = {
  // ── Issues ──
  listIssues(where: Prisma.SewingIssueWhereInput, order: Prisma.SewingIssueOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.sewingIssue.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include: issueInclude }),
      prisma.sewingIssue.count({ where }),
    ]);
  },
  getIssue(id: string, db: Db = prisma) {
    return db.sewingIssue.findUnique({ where: { id }, include: issueInclude });
  },
  async lockIssue(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM sewing_issues WHERE id = ${id}::uuid FOR UPDATE`;
  },
  createIssue(tx: Tx, data: Omit<Prisma.SewingIssueUncheckedCreateInput, 'lines'>, lines: { bundleId: string; pcs: number }[]) {
    return tx.sewingIssue.create({ data: { ...data, lines: { create: lines.map((l, i) => ({ lineNo: i + 1, ...l })) } } });
  },
  async updateIssue(tx: Tx, id: string, version: number, data: Prisma.SewingIssueUncheckedUpdateManyInput, lines: { bundleId: string; pcs: number }[]) {
    const r = await tx.sewingIssue.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.sewingIssueLine.deleteMany({ where: { issueId: id } });
    await tx.sewingIssueLine.createMany({ data: lines.map((l, i) => ({ issueId: id, lineNo: i + 1, ...l })) });
    return true;
  },
  setIssueState(tx: Tx, id: string, data: Prisma.SewingIssueUncheckedUpdateInput) {
    return tx.sewingIssue.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  deleteIssue(tx: Tx, id: string) {
    return tx.sewingIssue.delete({ where: { id } });
  },

  // ── Entries ──
  listEntries(where: Prisma.SewingEntryWhereInput, order: Prisma.SewingEntryOrderByWithRelationInput, p: Paging) {
    return prisma.$transaction([
      prisma.sewingEntry.findMany({ where, orderBy: order, skip: p.skip, take: p.take, include: entryInclude }),
      prisma.sewingEntry.count({ where }),
    ]);
  },
  getEntry(id: string, db: Db = prisma) {
    return db.sewingEntry.findUnique({ where: { id }, include: entryInclude });
  },
  async lockEntry(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM sewing_entries WHERE id = ${id}::uuid FOR UPDATE`;
  },
  createEntry(tx: Tx, data: Omit<Prisma.SewingEntryUncheckedCreateInput, 'lines'>, lines: { colour: string; size: string; pcs: number }[]) {
    return tx.sewingEntry.create({ data: { ...data, lines: { create: lines.map((l, i) => ({ lineNo: i + 1, ...l })) } } });
  },
  async updateEntry(tx: Tx, id: string, version: number, data: Prisma.SewingEntryUncheckedUpdateManyInput, lines: { colour: string; size: string; pcs: number }[]) {
    const r = await tx.sewingEntry.updateMany({ where: { id, version, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) return false;
    await tx.sewingEntryLine.deleteMany({ where: { entryId: id } });
    await tx.sewingEntryLine.createMany({ data: lines.map((l, i) => ({ entryId: id, lineNo: i + 1, ...l })) });
    return true;
  },
  setEntryState(tx: Tx, id: string, data: Prisma.SewingEntryUncheckedUpdateInput) {
    return tx.sewingEntry.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  deleteEntry(tx: Tx, id: string) {
    return tx.sewingEntry.delete({ where: { id } });
  },
};
