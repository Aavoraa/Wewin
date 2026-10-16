import { Prisma } from '@wewin/db';
import { type z } from 'zod';
import {
  CLASS_TARGET,
  D,
  type DateOrder,
  type Extraction,
  HEADER_FIELDS,
  type HeaderField,
  type Issue,
  LINE_FIELDS,
  type LineField,
  type Match,
  type PageLayout,
  type Review,
  type ReviewLine,
  type ReviewPatch,
  type ScanField,
  type ScanTarget,
  TARGET_SPECS,
  type ValidationContext,
  emptyField,
  matchItem,
  matchVendor,
  normText,
  normalizeDate,
  normalizeGstin,
  normalizeNumber,
  todayIst,
  validateReview,
  zBillInput,
  zTrimsDocInput,
  zYarnReceiptInput,
  buildPayload,
  type zAliasListQuery,
  type zScanListQuery,
} from '@wewin/shared';
import { prisma, withTx, afterCommit } from '../../core/db';
import { AppError, notFound, versionConflict } from '../../core/errors/app-error';
import { paging } from '../../core/list';
import { logger } from '../../core/logger';
import { audit } from '../../core/audit/audit.service';
import { assertPermission } from '../../core/auth/auth.middleware';
import { type CurrentUser } from '../../core/auth/auth.types';
import { settingsService } from '../../core/settings/settings.service';
import { QUEUES, jobs, registerJob } from '../../jobs/queue';
import { mastersService } from '../masters/masters.service';
import { yarnService } from '../yarn/yarn.service';
import { trimsService } from '../trims/trims.service';
import { billsService } from '../accounts/bills.service';
import { dateOnly, toDbDate } from '../../core/documents';
import { scansRepo as repo } from './scans.repo';
import { readStored, removeStored, storeUpload } from './scans.storage';
import { readTextLayer } from './extract/text-layer';
import { extractHeuristic } from './extract/heuristic';
import { aiEnabled, extractWithAi } from './extract/ai';

type Scan = NonNullable<Awaited<ReturnType<typeof repo.get>>>;
type Mode = 'auto' | 'local' | 'ai';
const RC = { isolation: 'ReadCommitted' } as const;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const asReview = (s: Scan) => s.review as unknown as Review | null;

async function scanSettings() {
  const s = await settingsService.getAll();
  return { minConfidence: Number(s['scan.minConfidence']) / 100, tolerance: s['scan.amountTolerance'], dateOrder: s['scan.dateOrder'] as DateOrder, retentionDays: s['scan.retentionDays'] };
}

async function companyTax() {
  try {
    const c = await settingsService.getCompany();
    return { gstin: c.gstin?.toUpperCase() ?? null, stateCode: c.stateCode ?? null };
  } catch {
    return { gstin: null, stateCode: null };
  }
}

// ───────── Matching ─────────
async function matchItems(target: ScanTarget | null, vendorId: string | null, lines: ReviewLine[]): Promise<ReviewLine[]> {
  const type = target ? TARGET_SPECS[target].itemType : null;
  if (!type) return lines.map((l) => (l.item.state === 'CONFIRMED' ? l : { ...l, item: { id: null, state: 'NONE', score: null, candidates: [] } }));
  const [items, aliases] = await Promise.all([mastersService.itemsForMatching([type]), vendorId ? repo.aliasesFor(vendorId) : Promise.resolve([])]);
  return lines.map((l) => {
    if (l.item.state === 'CONFIRMED') return l;
    const m = matchItem({ description: l.fields.description.value, vendorItemCode: l.fields.vendorItemCode.value, hsn: l.fields.hsn.value }, items, aliases as { itemId: string; normDescription: string; status: 'PROPOSED' | 'APPROVED' }[]);
    return { ...l, item: m };
  });
}

/** D.C. numbers printed on a job-work invoice → the vendor's posted, unbilled inwards. */
async function suggestSources(vendorId: string | null, dcRefs: string | null): Promise<Review['sources']> {
  if (!vendorId || !dcRefs) return [];
  const refs = dcRefs.split(/\s*,\s*/).map((r) => r.toUpperCase().replace(/\s+/g, '')).filter(Boolean);
  const cands = await billsService.candidates(vendorId, null);
  const out: Review['sources'] = [];
  for (const c of cands) {
    const own = c.vendorDcNo?.toUpperCase().replace(/\s+/g, '') ?? null;
    const against = c.against.split(/\s*,\s*/).map((a) => a.toUpperCase());
    const hit = refs.find((r) => r === own || r === c.docNo.toUpperCase() || against.includes(r) || (/^\d+$/.test(r) && own !== null && own.replace(/\D/g, '') === r));
    if (hit) out.push({ sourceType: c.sourceType, sourceId: c.sourceId, docNo: c.docNo, reason: `D.C. ${hit} on the invoice` });
  }
  return out;
}

async function buildReview(ex: Extraction, prev: Review | null): Promise<Review> {
  const vendors = await mastersService.vendorsForMatching();
  const target = prev?.target ?? CLASS_TARGET[ex.classification.class];
  const vendor: Match = prev?.vendor.state === 'CONFIRMED' ? prev.vendor : matchVendor({ gstin: ex.header.vendorGstin.value, name: ex.header.vendorName.value }, vendors);
  const header = { ...ex.header };
  // Keep the reviewer's own corrections across a reprocess.
  if (prev) for (const k of HEADER_FIELDS) if (prev.header[k].source === 'EDITED') header[k] = prev.header[k];
  const sameShape = prev && prev.lines.length === ex.lines.length;
  let lines: ReviewLine[] = ex.lines.map((l, i) => {
    const p = sameShape ? prev!.lines[i] : undefined;
    const fields = { ...l.fields };
    if (p) for (const k of LINE_FIELDS) if (p.fields[k].source === 'EDITED') fields[k] = p.fields[k];
    return { ...l, fields, include: p?.include ?? true, item: p?.item.state === 'CONFIRMED' ? p.item : { id: null, state: 'NONE', score: null, candidates: [] } };
  });
  lines = await matchItems(target, vendor.id, lines);
  const sources = target === 'VENDOR_BILL' ? (prev?.sources.length ? prev.sources : await suggestSources(vendor.id, header.dcRefs.value)) : [];
  return { target, vendor, header, lines, sources, existingDocId: prev?.existingDocId ?? null, confirmed: prev?.confirmed ?? [] };
}

// ───────── Validation against live ERP data ─────────
interface Checked {
  issues: Issue[];
  reconciliation: ReturnType<typeof validateReview>['reconciliation'];
  ready: boolean;
  checkedAt: string;
}

async function existingDocs(target: ScanTarget, vendorId: string, invoiceNo: string) {
  if (target === 'YARN_RECEIPT') return (await yarnService.bySupplierInvoice(vendorId, invoiceNo)).map((r) => ({ docType: 'YARN_RECEIPT', ...r }));
  if (target === 'TRIMS_RECEIPT') return (await trimsService.bySupplierInvoice(vendorId, invoiceNo)).map((r) => ({ docType: 'TRIMS_RECEIPT', ...r }));
  return (await billsService.byVendorInvoice(vendorId, invoiceNo)).map((r) => ({ docType: 'VENDOR_BILL', ...r, lines: [] as { itemId: string; qty: string; rate: string | null }[] }));
}

async function check(scan: Scan, review: Review): Promise<Checked> {
  const st = await scanSettings();
  const company = await companyTax();
  const vendor = review.vendor.id ? await mastersService.vendorById(review.vendor.id).catch(() => null) : null;
  const invoiceNo = review.header.invoiceNo.value;
  let duplicates: ValidationContext['duplicates'] = [];
  let existingLines: ValidationContext['existingLines'] = null;
  const extra: Issue[] = [];
  if (review.target && vendor && invoiceNo) {
    const docs = (await existingDocs(review.target, vendor.id, invoiceNo)).filter((d) => d.sourceScanId !== scan.id);
    const existing = docs.find((d) => d.id === review.existingDocId);
    if (review.existingDocId && !existing) extra.push({ level: 'ERROR', code: 'EXISTING_NOT_FOUND', field: 'existingDocId', message: 'The receipt chosen for reconciliation is not an entry of this invoice', ackKey: null, acknowledged: false });
    if (existing) existingLines = existing.lines;
    duplicates = docs.filter((d) => d.id !== review.existingDocId).map((d) => ({ docType: d.docType, docNo: d.docNo, id: d.id }));
    const otherScans = await repo.sameInvoice(vendor.id, invoiceNo, scan.id);
    for (const o of otherScans) {
      if (o.status === 'APPLIED' && o.appliedDocId === review.existingDocId) continue; // reconciling against the receipt that scan created
      if (o.status === 'APPLIED') duplicates.push({ docType: 'SCANNED_INVOICE', docNo: null, id: o.id });
      else extra.push({ level: 'WARNING', code: 'SCANNED_TWICE', field: 'header:invoiceNo', message: 'Another scan of this invoice is still in review', ackKey: null, acknowledged: false });
    }
  }
  const sameFile = await repo.sameFile(scan.sha256, scan.id);
  if (sameFile.length) extra.push({ level: 'WARNING', code: 'SAME_FILE', field: 'file', message: `This exact file was uploaded before (${sameFile.length} time${sameFile.length > 1 ? 's' : ''})`, ackKey: null, acknowledged: false });
  const ids = [...new Set(review.lines.map((l) => l.item.id).filter((x): x is string => !!x))];
  const items = ids.length ? await mastersService.itemsByIdsBrief(ids) : [];
  let billMatch: ValidationContext['billMatch'] = null;
  if (review.target === 'VENDOR_BILL' && review.sources.length && vendor && review.header.taxableAmount.value) {
    try {
      const body = zBillInput.parse({ ...buildPayload(review, { docDate: todayIst() }), vendorInvoiceNo: invoiceNo ?? 'PREVIEW' });
      const p = await billsService.preview(body);
      billMatch = { withinTolerance: p.match.withinTolerance, variance: p.match.variance, missingRates: p.match.missingRates };
    } catch (err) {
      extra.push({ level: 'ERROR', code: 'BILL_SOURCES', field: 'sources', message: err instanceof AppError ? err.message : 'The selected D.C.s cannot be billed', ackKey: null, acknowledged: false });
    }
  }
  const r = validateReview(review, {
    minConfidence: st.minConfidence,
    tolerance: st.tolerance,
    today: todayIst(),
    companyGstin: company.gstin,
    companyStateCode: company.stateCode,
    vendor: vendor ? { id: vendor.id, gstin: vendor.gstin, stateCode: vendor.stateCode, isActive: vendor.isActive } : null,
    duplicates,
    itemUnits: Object.fromEntries(items.map((i) => [i.id, { unit: i.unit, type: i.type, isActive: i.isActive }])),
    billMatch,
    existingLines,
  });
  const issues = [...r.issues, ...extra];
  return { issues, reconciliation: r.reconciliation, ready: r.ready && !extra.some((i) => i.level === 'ERROR'), checkedAt: new Date().toISOString() };
}

/** Denormalised columns that make duplicates and lists queryable. */
function summary(review: Review) {
  const total = review.header.totalAmount.value ?? review.header.amountPayable.value;
  return {
    target: review.target,
    vendorId: review.vendor.id,
    vendorInvoiceNo: review.header.invoiceNo.value?.slice(0, 60) ?? null,
    invoiceDate: review.header.invoiceDate.value ? toDbDate(review.header.invoiceDate.value) : null,
    totalAmount: total ? new Prisma.Decimal(D(total).toFixed(2)) : null,
  };
}

// ───────── Shaping ─────────
async function appliedDoc(scan: Scan) {
  if (!scan.appliedDocId || !scan.appliedDocType) return null;
  const target = scan.appliedDocType as ScanTarget;
  const found =
    target === 'YARN_RECEIPT' ? await yarnService.bySourceScan(scan.id) : target === 'TRIMS_RECEIPT' ? await trimsService.bySourceScan(scan.id) : await billsService.bySourceScan(scan.id);
  const linked = found ?? { id: scan.appliedDocId, docNo: null, status: 'LINKED' };
  return { docType: target, id: linked.id, docNo: linked.docNo, status: linked.status, route: `/${TARGET_SPECS[target].route}/${linked.id}`, linkedExisting: !found };
}

async function shape(scan: Scan) {
  const { layout: _layout, fileKey: _key, sha256: _sha, ...rest } = scan;
  return {
    ...rest,
    invoiceDate: dateOnly(scan.invoiceDate),
    totalAmount: scan.totalAmount?.toFixed(2) ?? null,
    extraction: scan.extraction as unknown as Extraction | null,
    review: asReview(scan),
    validation: scan.validation as unknown as Checked | null,
    applied: await appliedDoc(scan),
    fileUrl: scan.purgedAt ? null : `/api/v1/invoice-scans/${scan.id}/file`,
    aiAvailable: aiEnabled(),
  };
}

// ───────── Edits ─────────
const NUM_HEADER: HeaderField[] = ['subtotal', 'discount', 'freight', 'packing', 'otherCharges', 'taxableAmount', 'cgstRate', 'cgstAmount', 'sgstRate', 'sgstAmount', 'igstRate', 'igstAmount', 'roundOff', 'totalAmount', 'amountPayable', 'advancePaid'];
const NUM_LINE: LineField[] = ['qty', 'rate', 'gross', 'discount', 'taxable', 'taxRate', 'taxAmount', 'amount'];

function edited(prev: ScanField, raw: string | null, kind: 'num' | 'int' | 'date' | 'gstin' | 'text', dateOrder: DateOrder, label: string): ScanField {
  if (raw === null || raw === '') return { ...prev, value: null, source: 'EDITED', confidence: 1 };
  let value: string | null = raw.trim();
  if (kind === 'num' || kind === 'int') {
    value = normalizeNumber(raw).value;
    if (value === null || (kind === 'int' && !/^\d+$/.test(value))) throw new AppError('VALIDATION_ERROR', `${label}: "${raw}" is not a valid ${kind === 'int' ? 'whole number' : 'number'}`, 400);
  } else if (kind === 'date') {
    value = normalizeDate(raw, dateOrder).value ?? normalizeDate(raw, 'DMY').value;
    if (!value) throw new AppError('VALIDATION_ERROR', `${label}: "${raw}" is not a valid date`, 400);
  } else if (kind === 'gstin') {
    value = normalizeGstin(raw).value ?? raw.toUpperCase().replace(/\s/g, '');
  }
  return { ...prev, value, source: 'EDITED', confidence: 1, corrected: false };
}

export const scansService = {
  async upload(file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined, target: ScanTarget | null, user: CurrentUser) {
    if (!file) throw new AppError('VALIDATION_ERROR', 'Choose a PDF, JPG or PNG file to upload', 400);
    const stored = await storeUpload(file);
    try {
      const id = await withTx(async (tx) => {
        const s = await repo.create(tx, {
          fileKey: stored.key,
          originalName: stored.originalName,
          mimeType: stored.mime,
          sizeBytes: stored.size,
          sha256: stored.sha256,
          target,
          uploadedById: user.id,
        });
        await repo.event(tx, { scanId: s.id, kind: 'UPLOADED', note: `${stored.originalName} (${Math.round(stored.size / 1024)} KB)`, userId: user.id });
        afterCommit(tx, async () => void (await jobs.send(QUEUES.SCAN_EXTRACT, { scanId: s.id, mode: 'auto' }, { singletonKey: s.id })));
        return s.id;
      }, RC);
      return this.get(id);
    } catch (err) {
      await removeStored(stored.key);
      throw err;
    }
  },

  /** Background job: text layer → extraction → matching → validation. Idempotent per scan state. */
  async process(scanId: string, mode: Mode = 'auto') {
    if (!(await repo.claim(scanId))) return;
    const scan = (await repo.get(scanId))!;
    const st = await scanSettings();
    const company = await companyTax();
    try {
      const buf = await readStored(scan.fileKey);
      const layer = await readTextLayer(buf, scan.mimeType);
      let ex: Extraction;
      const useAi = mode === 'ai' || (mode === 'auto' && aiEnabled());
      if (useAi && !aiEnabled()) throw new AppError('SCAN_PROVIDER', 'AI extraction is not configured on this server', 400);
      if (useAi) {
        try {
          ex = await extractWithAi(buf, scan.mimeType, layer.pages, { dateOrder: st.dateOrder, textSource: layer.textSource });
        } catch (err) {
          if (mode === 'ai') throw err;
          logger.warn({ scanId, code: err instanceof AppError ? err.code : 'ERROR' }, 'AI extraction failed; using local extraction');
          ex = extractHeuristic(layer.pages, { dateOrder: st.dateOrder, companyGstin: company.gstin, textSource: layer.textSource });
          ex.warnings.push('AI extraction was unavailable; values come from local extraction');
        }
      } else {
        ex = extractHeuristic(layer.pages, { dateOrder: st.dateOrder, companyGstin: company.gstin, textSource: layer.textSource });
      }
      ex.warnings.unshift(...layer.warnings);
      const review = await buildReview(ex, asReview(scan));
      const checked = await check(scan, review);
      await withTx(async (tx) => {
        await repo.update(tx, scanId, {
          status: checked.ready ? 'READY' : 'NEEDS_REVIEW',
          extraction: json(ex),
          layout: json(layer.pages),
          review: json(review),
          validation: json(checked),
          pageCount: layer.pages.length,
          classification: ex.classification.class,
          extractor: ex.extractor,
          textSource: ex.textSource,
          processedAt: new Date(),
          error: null,
          ...summary(review),
        });
        await repo.event(tx, { scanId, kind: 'EXTRACTED', after: json({ extractor: ex.extractor, textSource: ex.textSource, lines: ex.lines.length, detectedRows: ex.detectedRows, class: ex.classification.class }) });
      }, RC);
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'Extraction failed unexpectedly';
      const transient = !(err instanceof AppError) || ['SCAN_PROVIDER_BUSY', 'SCAN_TIMEOUT'].includes(err.code);
      logger.warn({ scanId, code: err instanceof AppError ? err.code : 'ERROR', transient }, 'scan extraction failed');
      await withTx(async (tx) => {
        await repo.update(tx, scanId, { status: 'FAILED', error: message });
        await repo.event(tx, { scanId, kind: 'FAILED', note: message });
      }, RC);
      if (transient && scan.attempts < 3) throw err; // pg-boss retries with backoff
    }
  },

  async list(q: z.output<typeof zScanListQuery>) {
    const p = paging(q);
    const where: Prisma.InvoiceScanWhereInput = {
      ...(q.status ? { status: q.status } : { status: { not: 'DISCARDED' } }),
      ...(q.target ? { target: q.target } : {}),
      ...(q.vendorId ? { vendorId: q.vendorId } : {}),
      ...(q.q ? { OR: [{ originalName: { contains: q.q, mode: 'insensitive' } }, { vendorInvoiceNo: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await repo.list(where, p);
    const vendors = new Map((await mastersService.vendorsForMatching()).map((v) => [v.id, v.name]));
    return { rows: rows.map((r) => ({ ...r, invoiceDate: dateOnly(r.invoiceDate), totalAmount: r.totalAmount?.toFixed(2) ?? null, vendorName: r.vendorId ? (vendors.get(r.vendorId) ?? null) : null })), total, p };
  },

  async get(id: string) {
    const s = await repo.get(id);
    if (!s) throw notFound('Scanned document');
    return shape(s);
  },

  async layout(id: string) {
    const s = await repo.layout(id);
    if (!s) throw notFound('Scanned document');
    return (s.layout as unknown as PageLayout[] | null) ?? [];
  },

  async events(id: string) {
    return repo.events(id);
  },

  /** Serve the original file to an authorised user; every access is recorded. */
  async file(id: string, user: CurrentUser) {
    const s = await repo.get(id);
    if (!s) throw notFound('Scanned document');
    if (s.purgedAt) throw new AppError('NOT_FOUND', 'The file was deleted by the retention policy', 404);
    const buf = await readStored(s.fileKey);
    await repo.event(prisma, { scanId: id, kind: 'FILE_VIEWED', userId: user.id });
    return { buf, mime: s.mimeType, name: s.originalName };
  },

  async patchReview(id: string, patch: ReviewPatch, user: CurrentUser) {
    const st = await scanSettings();
    const scan = await withTx(async (tx) => {
      const s = await repo.lock(tx, id);
      if (!s) throw notFound('Scanned document');
      if (!['NEEDS_REVIEW', 'READY'].includes(s.status)) throw new AppError('INVALID_STATE', `A ${s.status.toLowerCase().replace('_', ' ')} scan cannot be edited`, 409);
      if (s.version !== patch.version) throw versionConflict();
      return s;
    }, RC);
    const before = asReview(scan)!;
    const review: Review = structuredClone(before);
    const events: { kind: string; field: string | null; before?: unknown; after?: unknown; note?: string }[] = [];

    if (patch.target !== undefined && patch.target !== review.target) {
      events.push({ kind: 'TARGET_SET', field: 'target', before: review.target, after: patch.target });
      review.target = patch.target;
      review.sources = [];
      review.existingDocId = null;
    }
    if (patch.vendorId !== undefined && patch.vendorId !== review.vendor.id) {
      if (patch.vendorId) await mastersService.vendorById(patch.vendorId);
      events.push({ kind: 'MATCH_CONFIRMED', field: 'vendor', before: review.vendor.id, after: patch.vendorId });
      review.vendor = { ...review.vendor, id: patch.vendorId, state: patch.vendorId ? 'CONFIRMED' : 'NONE' };
    }
    for (const [k, e] of Object.entries(patch.header ?? {}) as [HeaderField, { value: string | null }][]) {
      const kind = NUM_HEADER.includes(k) ? 'num' : k === 'invoiceDate' || k === 'dueDate' ? 'date' : k === 'vendorGstin' || k === 'buyerGstin' ? 'gstin' : 'text';
      const next = edited(review.header[k] ?? emptyField(), e.value, kind, st.dateOrder, k);
      if (next.value !== review.header[k].value) events.push({ kind: 'CORRECTED', field: `header:${k}`, before: review.header[k].value, after: next.value });
      review.header[k] = next;
    }
    if (patch.addLine) {
      const n = Math.max(0, ...review.lines.map((l) => l.lineNo)) + 1;
      review.lines.push({ lineNo: n, page: null, include: true, item: { id: null, state: 'NONE', score: null, candidates: [] }, fields: Object.fromEntries(LINE_FIELDS.map((f) => [f, emptyField()])) as ReviewLine['fields'] });
      events.push({ kind: 'LINE_ADDED', field: `line:${n}` });
    }
    const proposals: { desc: string; itemId: string }[] = [];
    for (const le of patch.lines ?? []) {
      const line = review.lines.find((l) => l.lineNo === le.lineNo);
      if (!line) throw new AppError('VALIDATION_ERROR', `Line ${le.lineNo} does not exist`, 400);
      if (le.include !== undefined && le.include !== line.include) {
        events.push({ kind: le.include ? 'LINE_INCLUDED' : 'LINE_EXCLUDED', field: `line:${le.lineNo}` });
        line.include = le.include;
      }
      for (const [k, e] of Object.entries(le.fields ?? {}) as [LineField, { value: string | null }][]) {
        const next = edited(line.fields[k], e.value, NUM_LINE.includes(k) ? 'num' : k === 'bags' ? 'int' : 'text', st.dateOrder, `Line ${le.lineNo} ${k}`);
        if (next.value !== line.fields[k].value) events.push({ kind: 'CORRECTED', field: `line:${le.lineNo}:${k}`, before: line.fields[k].value, after: next.value });
        line.fields[k] = next;
      }
      if (le.itemId !== undefined && (le.itemId !== line.item.id || line.item.state !== 'CONFIRMED')) {
        events.push({ kind: 'MATCH_CONFIRMED', field: `line:${le.lineNo}:item`, before: line.item.id, after: le.itemId });
        line.item = { ...line.item, id: le.itemId, state: le.itemId ? 'CONFIRMED' : 'NONE' };
        if (le.itemId && line.fields.description.value) proposals.push({ desc: line.fields.description.value, itemId: le.itemId });
      }
    }
    if (patch.sources) {
      const vendorId = review.vendor.id;
      if (!vendorId) throw new AppError('VALIDATION_ERROR', 'Pick the vendor before choosing D.C.s', 400);
      const cands = await billsService.candidates(vendorId, null);
      const byId = new Map(cands.map((c) => [`${c.sourceType}|${c.sourceId}`, c]));
      review.sources = patch.sources.map((s) => {
        const c = byId.get(`${s.sourceType}|${s.sourceId}`);
        if (!c) throw new AppError('ALREADY_BILLED', 'A selected D.C. is not a posted, unbilled D.C. of this vendor', 409);
        return { sourceType: c.sourceType, sourceId: c.sourceId, docNo: c.docNo, reason: 'Chosen by reviewer' };
      });
      events.push({ kind: 'SOURCES_SET', field: 'sources', after: review.sources.map((s) => s.docNo) });
    }
    if (patch.existingDocId !== undefined) {
      events.push({ kind: 'RECONCILE_WITH', field: 'existingDocId', before: review.existingDocId, after: patch.existingDocId });
      review.existingDocId = patch.existingDocId;
    }
    for (const key of patch.confirm ?? []) {
      if (!review.confirmed.includes(key)) {
        review.confirmed.push(key);
        events.push({ kind: key.startsWith('ack:') ? 'ACKNOWLEDGED' : 'CONFIRMED', field: key });
      }
    }
    // A changed value must be confirmed again; re-match items when the target or vendor changed.
    const changedKeys = new Set(events.filter((e) => e.kind === 'CORRECTED').map((e) => e.field));
    review.confirmed = review.confirmed.filter((k) => !changedKeys.has(k) || (patch.confirm ?? []).includes(k));
    if (events.some((e) => e.kind === 'TARGET_SET' || (e.kind === 'MATCH_CONFIRMED' && e.field === 'vendor'))) {
      review.lines = await matchItems(review.target, review.vendor.id, review.lines);
      if (review.target === 'VENDOR_BILL' && !review.sources.length) review.sources = await suggestSources(review.vendor.id, review.header.dcRefs.value);
    }

    const checked = await check(scan, review);
    await withTx(async (tx) => {
      const cur = await repo.lock(tx, id);
      if (!cur || cur.version !== patch.version) throw versionConflict();
      await repo.update(tx, id, { review: json(review), validation: json(checked), status: checked.ready ? 'READY' : 'NEEDS_REVIEW', reviewedById: user.id, ...summary(review) });
      for (const e of events) {
        await repo.event(tx, { scanId: id, kind: e.kind, field: e.field, before: e.before === undefined ? undefined : json({ value: e.before }), after: e.after === undefined ? undefined : json({ value: e.after }), userId: user.id });
      }
      if (review.vendor.id) {
        for (const p of proposals) await repo.proposeAlias(tx, { vendorId: review.vendor.id, normDescription: normText(p.desc), sampleDescription: p.desc, itemId: p.itemId, userId: user.id });
      }
    }, RC);
    return this.get(id);
  },

  async reprocess(id: string, mode: Mode, user: CurrentUser) {
    await withTx(async (tx) => {
      const s = await repo.lock(tx, id);
      if (!s) throw notFound('Scanned document');
      if (!['NEEDS_REVIEW', 'READY', 'FAILED'].includes(s.status)) throw new AppError('INVALID_STATE', 'Only a scan in review or a failed scan can be reprocessed', 409);
      if (s.purgedAt) throw new AppError('INVALID_STATE', 'The file was deleted by the retention policy', 409);
      if (mode === 'ai' && !aiEnabled()) throw new AppError('SCAN_PROVIDER', 'AI extraction is not configured on this server', 400);
      await repo.update(tx, id, { status: 'QUEUED', error: null, attempts: 0 });
      await repo.event(tx, { scanId: id, kind: 'REPROCESS', note: mode, userId: user.id });
      afterCommit(tx, async () => void (await jobs.send(QUEUES.SCAN_EXTRACT, { scanId: id, mode }, { singletonKey: `${id}:${Date.now()}` })));
    }, RC);
    return this.get(id);
  },

  async discard(id: string, reason: string, user: CurrentUser) {
    await withTx(async (tx) => {
      const s = await repo.lock(tx, id);
      if (!s) throw notFound('Scanned document');
      if (s.status === 'APPLIED') throw new AppError('INVALID_STATE', 'This scan already created a document; cancel that document instead', 409);
      if (s.status === 'DISCARDED') return;
      await repo.update(tx, id, { status: 'DISCARDED', discardedAt: new Date() });
      await repo.event(tx, { scanId: id, kind: 'DISCARDED', note: reason, userId: user.id });
      await audit.log(tx, { docType: 'INVOICE_SCAN', recordId: id, action: 'DISCARD', reason });
    }, RC);
    return this.get(id);
  },

  /**
   * Create the DRAFT Wewin document from a validated scan through the existing module service.
   * Nothing is posted: stock and accounts change only when that draft is posted by an authorised
   * user. Idempotent — the draft carries source_scan_id (unique), so retries never duplicate it.
   */
  async apply(id: string, body: { version: number; docDate?: string }, user: CurrentUser) {
    assertPermission(user, 'scans.apply');
    const scan = await repo.get(id);
    if (!scan) throw notFound('Scanned document');
    if (scan.status === 'APPLIED') return this.get(id);
    if (!['READY', 'NEEDS_REVIEW'].includes(scan.status)) throw new AppError('INVALID_STATE', 'This scan is not ready to be used', 409);
    if (scan.version !== body.version) throw versionConflict();
    const review = asReview(scan)!;
    if (!review.target) throw new AppError('VALIDATION_ERROR', 'Choose the document type first', 400);
    const spec = TARGET_SPECS[review.target];
    assertPermission(user, spec.createPermission);
    const checked = await check(scan, review);
    if (!checked.ready) {
      throw new AppError('SCAN_NOT_READY', 'Resolve the highlighted problems before creating the document', 409, { issues: checked.issues.filter((i) => i.level === 'ERROR' && !i.acknowledged) });
    }

    let docId: string;
    let linked = false;
    if (review.existingDocId) {
      docId = review.existingDocId;
      linked = true;
    } else {
      const found = review.target === 'YARN_RECEIPT' ? await yarnService.bySourceScan(id) : review.target === 'TRIMS_RECEIPT' ? await trimsService.bySourceScan(id) : await billsService.bySourceScan(id);
      if (found) docId = found.id;
      else {
        const payload = buildPayload(review, { docDate: body.docDate ?? todayIst() });
        try {
          if (review.target === 'YARN_RECEIPT') docId = (await yarnService.create(zYarnReceiptInput.parse(payload), user, { sourceScanId: id })).id;
          else if (review.target === 'TRIMS_RECEIPT') docId = (await trimsService.create(zTrimsDocInput.parse(payload), user, { sourceScanId: id })).id;
          else docId = (await billsService.create(zBillInput.parse(payload), user, { sourceScanId: id })).id;
        } catch (err) {
          // A concurrent apply created it first: use that draft.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && JSON.stringify(err.meta ?? {}).includes('source_scan_id')) {
            const again = review.target === 'YARN_RECEIPT' ? await yarnService.bySourceScan(id) : review.target === 'TRIMS_RECEIPT' ? await trimsService.bySourceScan(id) : await billsService.bySourceScan(id);
            if (!again) throw err;
            docId = again.id;
          } else throw err;
        }
      }
    }
    await withTx(async (tx) => {
      const cur = await repo.lock(tx, id);
      if (!cur || cur.status === 'APPLIED') return;
      await repo.update(tx, id, { status: 'APPLIED', appliedDocType: review.target, appliedDocId: docId, appliedAt: new Date(), validation: json(checked) });
      await repo.event(tx, { scanId: id, kind: linked ? 'LINKED' : 'APPLIED', after: json({ docType: review.target, docId }), userId: user.id });
      await audit.log(tx, { docType: 'INVOICE_SCAN', recordId: id, action: 'APPLY', data: { target: review.target, docId, linked, acknowledged: review.confirmed.filter((k) => k.startsWith('ack:')) } });
    }, RC);
    return this.get(id);
  },

  /** Unbilled D.C.s of the scan's vendor (for job-work bills). */
  async sourceCandidates(id: string) {
    const s = await repo.get(id);
    if (!s) throw notFound('Scanned document');
    const r = asReview(s);
    if (!r?.vendor.id) return [];
    return billsService.candidates(r.vendor.id, null);
  },

  // ───────── Learned descriptions ─────────
  async listAliases(q: z.output<typeof zAliasListQuery>) {
    const p = paging(q);
    const where: Prisma.VendorItemAliasWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.vendorId ? { vendorId: q.vendorId } : {}), ...(q.q ? { sampleDescription: { contains: q.q, mode: 'insensitive' } } : {}) };
    const [rows, total] = await repo.listAliases(where, p);
    const [vendors, items] = await Promise.all([mastersService.vendorsForMatching(), mastersService.itemsByIdsBrief([...new Set(rows.map((r) => r.itemId))])]);
    const vn = new Map(vendors.map((v) => [v.id, v.name]));
    const it = new Map(items.map((i) => [i.id, `${i.code} · ${i.name}`]));
    return { rows: rows.map((r) => ({ ...r, vendorName: vn.get(r.vendorId) ?? '', itemLabel: it.get(r.itemId) ?? '' })), total, p };
  },

  async decideAlias(id: string, version: number, status: 'APPROVED' | 'REJECTED', user: CurrentUser) {
    assertPermission(user, 'scans.aliases.approve');
    await withTx(async (tx) => {
      const a = await repo.getAlias(id, tx);
      if (!a) throw notFound('Learned description');
      if (!(await repo.decideAlias(tx, id, version, status, user.id))) throw versionConflict();
      await audit.log(tx, { docType: 'VENDOR_ITEM_ALIAS', recordId: id, action: status === 'APPROVED' ? 'APPROVE' : 'REJECT', data: { vendorId: a.vendorId, itemId: a.itemId, description: a.sampleDescription } });
    }, RC);
    return repo.getAlias(id);
  },

  /** Retention: delete files and extracted content of discarded / failed scans after N days. */
  async purge() {
    const { retentionDays } = await scanSettings();
    const before = new Date(Date.now() - retentionDays * 86_400_000);
    const rows = await repo.purgeable(before);
    for (const r of rows) {
      await removeStored(r.fileKey);
      await withTx(async (tx) => {
        await repo.update(tx, r.id, { extraction: Prisma.DbNull, layout: Prisma.DbNull, review: Prisma.DbNull, validation: Prisma.DbNull, purgedAt: new Date() });
        await repo.event(tx, { scanId: r.id, kind: 'PURGED', note: `Retention ${retentionDays} days` });
      }, RC);
    }
    return { purged: rows.length };
  },
};

registerJob(QUEUES.SCAN_EXTRACT, async (data) => scansService.process(String(data.scanId), (data.mode as Mode) ?? 'auto'));
registerJob(QUEUES.SCAN_RETENTION, async () => logger.info({ result: await scansService.purge() }, 'scan retention'));
