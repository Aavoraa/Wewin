import { type Prisma } from '@wewin/db';
import { type Tx, prisma } from '../../core/db';
import { type Paging } from '../../core/list';

type Db = Tx | typeof prisma;

/** Columns for lists: never the heavy JSON (extraction, word layout). */
const listSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  pageCount: true,
  status: true,
  target: true,
  classification: true,
  extractor: true,
  textSource: true,
  vendorId: true,
  vendorInvoiceNo: true,
  invoiceDate: true,
  totalAmount: true,
  appliedDocType: true,
  appliedDocId: true,
  error: true,
  attempts: true,
  uploadedById: true,
  version: true,
  createdAt: true,
  processedAt: true,
  appliedAt: true,
  purgedAt: true,
} satisfies Prisma.InvoiceScanSelect;

export const scansRepo = {
  create(tx: Tx, data: Prisma.InvoiceScanUncheckedCreateInput) {
    return tx.invoiceScan.create({ data, select: { id: true } });
  },
  get(id: string, db: Db = prisma) {
    return db.invoiceScan.findUnique({ where: { id } });
  },
  layout(id: string) {
    return prisma.invoiceScan.findUnique({ where: { id }, select: { layout: true, purgedAt: true } });
  },
  list(where: Prisma.InvoiceScanWhereInput, p: Paging) {
    return prisma.$transaction([
      prisma.invoiceScan.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, select: listSelect }),
      prisma.invoiceScan.count({ where }),
    ]);
  },
  async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT 1 FROM invoice_scans WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.invoiceScan.findUnique({ where: { id } });
  },
  update(tx: Tx, id: string, data: Prisma.InvoiceScanUncheckedUpdateInput) {
    return tx.invoiceScan.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  /** Move to PROCESSING only from a state that may be (re)processed — makes the job idempotent. */
  async claim(id: string) {
    const r = await prisma.invoiceScan.updateMany({
      where: { id, status: { in: ['QUEUED', 'FAILED'] }, purgedAt: null },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, version: { increment: 1 } },
    });
    return r.count === 1;
  },
  event(tx: Tx | typeof prisma, e: { scanId: string; kind: string; field?: string | null; before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue; note?: string | null; userId?: string | null }) {
    return tx.invoiceScanEvent.create({ data: e });
  },
  events(scanId: string) {
    return prisma.invoiceScanEvent.findMany({ where: { scanId }, orderBy: { createdAt: 'asc' } });
  },
  sameFile(sha256: string, excludeId: string) {
    return prisma.invoiceScan.findMany({ where: { sha256, id: { not: excludeId }, status: { not: 'DISCARDED' } }, select: { id: true, status: true, createdAt: true, originalName: true } });
  },
  sameInvoice(vendorId: string, invoiceNo: string, excludeId: string) {
    return prisma.invoiceScan.findMany({
      where: { vendorId, vendorInvoiceNo: { equals: invoiceNo, mode: 'insensitive' }, id: { not: excludeId }, status: { in: ['NEEDS_REVIEW', 'READY', 'APPLIED'] } },
      select: { id: true, status: true, appliedDocType: true, appliedDocId: true },
    });
  },
  purgeable(before: Date) {
    return prisma.invoiceScan.findMany({ where: { status: { in: ['DISCARDED', 'FAILED'] }, updatedAt: { lt: before }, purgedAt: null }, select: { id: true, fileKey: true } });
  },

  // ───────── Learned vendor item descriptions ─────────
  aliasesFor(vendorId: string) {
    return prisma.vendorItemAlias.findMany({ where: { vendorId, status: { in: ['PROPOSED', 'APPROVED'] } }, select: { itemId: true, normDescription: true, status: true } });
  },
  async proposeAlias(tx: Tx, a: { vendorId: string; normDescription: string; sampleDescription: string; itemId: string; userId: string }) {
    await tx.vendorItemAlias.upsert({
      where: { vendorId_normDescription_itemId: { vendorId: a.vendorId, normDescription: a.normDescription, itemId: a.itemId } },
      create: { vendorId: a.vendorId, normDescription: a.normDescription, sampleDescription: a.sampleDescription.slice(0, 300), itemId: a.itemId, proposedById: a.userId },
      // A rejected mapping is not revived by another confirmation; it only counts.
      update: { timesConfirmed: { increment: 1 } },
    });
  },
  listAliases(where: Prisma.VendorItemAliasWhereInput, p: Paging) {
    return prisma.$transaction([
      prisma.vendorItemAlias.findMany({ where, orderBy: [{ status: 'asc' }, { timesConfirmed: 'desc' }], skip: p.skip, take: p.take }),
      prisma.vendorItemAlias.count({ where }),
    ]);
  },
  getAlias(id: string, db: Db = prisma) {
    return db.vendorItemAlias.findUnique({ where: { id } });
  },
  async decideAlias(tx: Tx, id: string, version: number, status: 'APPROVED' | 'REJECTED', userId: string) {
    const r = await tx.vendorItemAlias.updateMany({ where: { id, version }, data: { status, decidedById: userId, decidedAt: new Date(), version: { increment: 1 } } });
    return r.count === 1;
  },
};
