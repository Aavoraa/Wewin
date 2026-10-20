import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  History,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  type HeaderField,
  type Issue,
  type LineField,
  type ReviewLine,
  type ReviewPatch,
  SCAN_TARGETS,
  type ScanField,
  type ScanTarget,
  TARGET_SPECS,
  D,
  isDcTarget,
  label as baseLabel,
} from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDocumentHotkeys } from '@/lib/hotkeys';
import { formatDate, formatDateTimeIst, formatInr } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EntityPicker } from '@/components/EntityPicker';
import { ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { pickers } from '../orders/api';
import { DocumentPreview, type Highlight } from './DocumentPreview';
import { ScanStatusBadge } from './ScansPage';
import { type ScanDetail, type ScanEvent, TARGET_LABEL } from './types';

interface LineEdit {
  include?: boolean;
  itemId?: string | null;
  fields?: Partial<Record<LineField, string | null>>;
}
interface Edits {
  target?: ScanTarget | null;
  vendorId?: string | null;
  header: Partial<Record<HeaderField, string | null>>;
  lines: Record<number, LineEdit>;
  confirm: string[];
}
const NO_EDITS: Edits = { header: {}, lines: {}, confirm: [] };
const editCount = (e: Edits) =>
  Object.keys(e.header).length +
  Object.values(e.lines).reduce(
    (a, l) =>
      a +
      Object.keys(l.fields ?? {}).length +
      (l.itemId !== undefined ? 1 : 0) +
      (l.include !== undefined ? 1 : 0),
    0,
  ) +
  e.confirm.length +
  (e.target !== undefined ? 1 : 0) +
  (e.vendorId !== undefined ? 1 : 0);

const SOURCE_TONE: Record<ScanField['source'], { label: string; cls: string }> = {
  EXTRACTED: { label: 'Read', cls: 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950 dark:text-sky-200' },
  DERIVED: {
    label: 'Derived',
    cls: 'bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950 dark:text-violet-200',
  },
  EDITED: {
    label: 'Edited',
    cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200',
  },
  MASTER: { label: 'Master', cls: 'bg-slate-100 text-slate-700 ring-slate-300' },
  MISSING: { label: 'Not found', cls: 'bg-slate-50 text-slate-500 ring-slate-200' },
};

function SourceChip({ f, min }: { f: ScanField; min: number }) {
  const t = SOURCE_TONE[f.source];
  const low = f.source === 'EXTRACTED' && ((f.confidence ?? 0) < min || f.corrected);
  return (
    <span className="flex items-center gap-1">
      <span className={cn('rounded px-1 py-px text-[10px] font-medium ring-1', t.cls)}>{t.label}</span>
      {f.source === 'EXTRACTED' && f.confidence !== null ? (
        <span
          title={f.corrected ? 'OCR correction applied' : 'Read confidence'}
          className={cn(
            'text-[10px] tabular-nums',
            low ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
          )}
        >
          {Math.round(f.confidence * 100)}%{f.corrected ? '*' : ''}
        </span>
      ) : null}
    </span>
  );
}

const IDENTITY: HeaderField[] = [
  'invoiceNo',
  'invoiceDate',
  'dueDate',
  'poNumber',
  'dcRefs',
  'paymentTerms',
  'currency',
  'invoiceType',
];
const DC_IDENTITY: HeaderField[] = ['invoiceNo', 'invoiceDate', 'dcRefs', 'poNumber', 'invoiceType'];
const PO_IDENTITY: HeaderField[] = [
  'poNumber',
  'invoiceDate',
  'shipDate',
  'styleNo',
  'styleName',
  'currency',
  'invoiceType',
];

/** Field names as a delivery challan / buyer PO prints them. */
function fieldLabelFor(target: ScanTarget | null) {
  return (k: string) => {
    if (target === 'ORDER') {
      const po: Record<string, string> = {
        poNumber: 'Buyer PO no.',
        invoiceDate: 'PO date',
        shipDate: 'Ship date',
        styleNo: 'Style no.',
        styleName: 'Style name',
        invoiceType: 'Document type',
      };
      return po[k] ?? baseLabel(k);
    }
    if (!isDcTarget(target)) return baseLabel(k);
    if (k === 'invoiceNo') return target === 'INWARD_DC' ? "Job worker's D.C. no." : 'Paper D.C. no.';
    if (k === 'invoiceDate') return 'D.C. date';
    if (k === 'dcRefs') return 'Refers to D.C. no(s).';
    if (k === 'invoiceType') return 'Document type';
    return baseLabel(k);
  };
}
const PARTY: HeaderField[] = ['vendorName', 'vendorGstin', 'vendorAddress', 'vendorPhone', 'buyerGstin'];
const AMOUNTS: HeaderField[] = [
  'subtotal',
  'discount',
  'freight',
  'packing',
  'otherCharges',
  'taxableAmount',
  'cgstRate',
  'cgstAmount',
  'sgstRate',
  'sgstAmount',
  'igstRate',
  'igstAmount',
  'roundOff',
  'totalAmount',
  'amountPayable',
  'advancePaid',
];

export function ScanReviewPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = ['invoice-scan', id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<ScanDetail>(`/invoice-scans/${id}`),
    refetchInterval: (query) =>
      ['QUEUED', 'PROCESSING'].includes(query.state.data?.status ?? '') ? 1500 : false,
  });
  const scan = q.data;
  const [edits, setEdits] = useState<Edits>(NO_EDITS);
  const [focus, setFocus] = useState<Highlight | null>(null);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => setEdits(NO_EDITS), [scan?.version]);

  const review = scan?.review ?? null;
  const editable = !!scan && ['NEEDS_REVIEW', 'READY'].includes(scan.status) && can('scans.upload');
  const target = edits.target !== undefined ? edits.target : (review?.target ?? null);
  const spec = target ? TARGET_SPECS[target] : null;
  const mapped = useMemo(() => new Map((spec?.fields ?? []).map((f) => [f.source, f])), [spec]);
  const dirty = editCount(edits) > 0;
  const dc = isDcTarget(target);
  const po = target === 'ORDER';
  const fieldLabel = fieldLabelFor(target);

  async function save(extra: Partial<Omit<ReviewPatch, 'version'>> = {}) {
    if (!scan) return;
    setSaving(true);
    try {
      const body: ReviewPatch = {
        version: scan.version,
        ...(edits.target !== undefined ? { target: edits.target } : {}),
        ...(edits.vendorId !== undefined ? { vendorId: edits.vendorId } : {}),
        header: Object.fromEntries(
          Object.entries(edits.header).map(([k, v]) => [k, { value: v ?? null }]),
        ) as ReviewPatch['header'],
        lines: Object.entries(edits.lines).map(([n, l]) => ({
          lineNo: Number(n),
          ...(l.include !== undefined ? { include: l.include } : {}),
          ...(l.itemId !== undefined ? { itemId: l.itemId } : {}),
          ...(l.fields
            ? {
                fields: Object.fromEntries(
                  Object.entries(l.fields).map(([k, v]) => [k, { value: v ?? null }]),
                ) as Record<LineField, { value: string | null }>,
              }
            : {}),
        })),
        confirm: [...edits.confirm, ...(extra.confirm ?? [])],
        ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'confirm')),
      };
      const next = await api.patch<ScanDetail>(`/invoice-scans/${id}/review`, body);
      qc.setQueryData(key, next);
      setEdits(NO_EDITS);
      toast.success(next.status === 'READY' ? 'Saved — ready to create the draft' : 'Saved');
      return next;
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }

  useDocumentHotkeys(
    { save: () => editable && dirty && void save().catch(() => undefined), post: () => undefined },
    true,
  );

  if (q.isLoading) return <LoadingState />;
  if (q.error || !scan) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const processing = ['QUEUED', 'PROCESSING'].includes(scan.status);
  const issues = scan.validation?.issues ?? [];
  const blocking = issues.filter((i) => i.level === 'ERROR' && !i.acknowledged);
  const confirmed = new Set([...(review?.confirmed ?? []), ...edits.confirm]);
  const toggleConfirm = (k: string) =>
    setEdits((e) => ({
      ...e,
      confirm: e.confirm.includes(k) ? e.confirm.filter((x) => x !== k) : [...e.confirm, k],
    }));
  const focusField = (f: ScanField | undefined) => f?.page && f.box && setFocus({ page: f.page, box: f.box });

  function headerInput(k: HeaderField) {
    if (!review) return null;
    const f = review.header[k];
    const m = mapped.get(`header:${k}`);
    const value = k in edits.header ? (edits.header[k] ?? '') : (f.value ?? '');
    const fk = `header:${k}`;
    const uncertain = f.source === 'EXTRACTED' && ((f.confidence ?? 0) < scan!.minConfidence || f.corrected);
    const issue = issues.find((i) => i.field === fk && !i.acknowledged);
    return (
      <div
        key={k}
        className={cn(
          'grid gap-1 rounded-md p-1.5',
          issue?.level === 'ERROR' && 'bg-red-50 ring-1 ring-red-200 dark:bg-red-950/40 dark:ring-red-900',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`h-${k}`} className="text-xs font-medium text-muted-foreground">
            {fieldLabel(k)}
            {m?.mandatory ? ' *' : ''}
          </label>
          <SourceChip f={f} min={scan!.minConfidence} />
        </div>
        <div className="flex items-center gap-1">
          <Input
            id={`h-${k}`}
            value={value}
            disabled={!editable}
            className={cn('h-8', uncertain && !confirmed.has(fk) && 'border-amber-400')}
            onFocus={() => focusField(f)}
            onChange={(e) => setEdits((x) => ({ ...x, header: { ...x.header, [k]: e.target.value } }))}
          />
          {uncertain && editable ? (
            <Button
              size="icon-sm"
              variant={confirmed.has(fk) ? 'secondary' : 'outline'}
              aria-label={`Confirm ${fieldLabel(k)}`}
              title="I checked this against the document"
              onClick={() => toggleConfirm(fk)}
            >
              <Check className={confirmed.has(fk) ? 'text-emerald-600' : ''} />
            </Button>
          ) : null}
        </div>
        {m?.target ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            → {spec?.entity}.{m.target}
          </span>
        ) : null}
        {f.raw && f.value && f.raw !== f.value ? (
          <span className="text-[10px] text-muted-foreground">Printed: “{f.raw}”</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-20">
      {/* Title bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/scans" className="text-sm text-muted-foreground hover:text-foreground">
            ← Scans
          </Link>
          <h1 className="text-lg font-semibold">{scan.originalName}</h1>
          <ScanStatusBadge status={scan.status} />
          {scan.extractor ? (
            <span className="text-xs text-muted-foreground">
              {scan.extractor.startsWith('anthropic') ? 'AI extraction' : 'Local extraction'} ·{' '}
              {scan.textSource === 'PDF_TEXT'
                ? 'PDF text'
                : scan.textSource === 'OCR'
                  ? 'OCR'
                  : scan.textSource === 'MIXED'
                    ? 'PDF text + OCR'
                    : 'AI'}{' '}
              · {scan.pageCount} page
              {scan.pageCount === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
        {scan.applied ? (
          <Button asChild>
            <Link to={scan.applied.route}>
              <FileCheck2 />{' '}
              {scan.applied.linkedExisting
                ? 'Open the existing document'
                : `Open draft ${TARGET_LABEL[scan.applied.docType].toLowerCase()}`}{' '}
              ({scan.applied.docNo ?? scan.applied.status})
            </Link>
          </Button>
        ) : null}
      </div>

      {processing ? (
        <Card>
          <CardContent className="flex items-center gap-3 text-sm">
            <Loader2 className="size-5 animate-spin text-muted-foreground" /> Reading the document — text,
            tables and totals. Scanned pages take a few seconds each.
          </CardContent>
        </Card>
      ) : null}
      {scan.status === 'FAILED' ? (
        <Card className="border-destructive/50">
          <CardContent className="flex items-start gap-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4" /> {scan.error ?? 'Extraction failed'}. Reprocess it, try
            AI extraction if available, or discard it.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Left: the original */}
        <div className="h-[calc(100vh-11rem)] min-h-[420px] xl:sticky xl:top-16">
          {scan.fileUrl ? (
            <DocumentPreview
              fileUrl={scan.fileUrl}
              mime={scan.mimeType}
              highlight={focus}
              pageCount={scan.pageCount}
            />
          ) : (
            <Card>
              <CardContent className="text-sm text-muted-foreground">
                The file was deleted by the retention policy.
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: ERP fields */}
        <div className="flex min-w-0 flex-col gap-3">
          {review && scan.extraction ? (
            <>
              {scan.extraction.warnings.length ? (
                <Card>
                  <CardContent className="grid gap-1 text-sm">
                    {scan.extraction.warnings.map((w) => (
                      <div key={w} className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <label htmlFor="scan-type" className="text-xs font-medium text-muted-foreground">
                      Create as *
                    </label>
                    <Select
                      id="scan-type"
                      value={target ?? ''}
                      disabled={!editable}
                      onChange={(e) =>
                        setEdits((x) => ({ ...x, target: (e.target.value || null) as ScanTarget | null }))
                      }
                    >
                      <option value="">— choose —</option>
                      {SCAN_TARGETS.map((t) => (
                        <option key={t} value={t}>
                          {TARGET_LABEL[t]}
                        </option>
                      ))}
                    </Select>
                    <span className="text-[11px] text-muted-foreground">
                      Detected: {scan.extraction.classification.class.replace('_', ' ').toLowerCase()} (
                      {Math.round(scan.extraction.classification.confidence * 100)}%)
                    </span>
                  </div>
                  <VendorBox
                    scan={scan}
                    edits={edits}
                    setEdits={setEdits}
                    editable={editable}
                    confirmed={confirmed}
                    toggleConfirm={toggleConfirm}
                    label={po ? 'Buyer *' : dc ? 'Job worker *' : 'Vendor *'}
                    buyer={po}
                  />
                </CardContent>
              </Card>

              {target === 'OUTWARD_DC' ? (
                <ProgramProcessBox
                  scan={scan}
                  editable={editable && edits.vendorId === undefined}
                  save={save}
                />
              ) : null}

              <Section title={po ? 'Buyer PO' : dc ? 'Delivery challan' : 'Invoice'}>
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {(po ? PO_IDENTITY : dc ? DC_IDENTITY : IDENTITY).map(headerInput)}
                </div>
                {po ? (
                  <p className="text-[11px] text-muted-foreground">
                    Order no., style item and garment components are not on a buyer PO — you add them on the
                    order form after “Create order”.
                  </p>
                ) : null}
              </Section>
              <Section title="Parties" collapsed>
                <div className="grid gap-1 sm:grid-cols-2">{PARTY.map(headerInput)}</div>
              </Section>

              {target === 'VENDOR_BILL' ? (
                <SourcesBox scan={scan} editable={editable} save={save} />
              ) : (
                <LinesBox
                  scan={scan}
                  edits={edits}
                  setEdits={setEdits}
                  editable={editable}
                  confirmed={confirmed}
                  toggleConfirm={toggleConfirm}
                  focusField={focusField}
                  save={save}
                />
              )}
              {target === 'INWARD_DC' ? (
                <OutwardLinksBox scan={scan} editable={editable && !dirty} save={save} />
              ) : null}

              {!dc && !po ? (
                <Section title="Amounts and taxes">
                  <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
                    {AMOUNTS.filter(
                      (k) =>
                        review.header[k].value ||
                        k in edits.header ||
                        ['taxableAmount', 'totalAmount', 'cgstAmount', 'sgstAmount', 'igstAmount'].includes(
                          k,
                        ),
                    ).map(headerInput)}
                  </div>
                  {scan.validation ? <Reconciliation r={scan.validation.reconciliation} /> : null}
                </Section>
              ) : null}

              {scan.validation?.duplicates.length && target !== 'VENDOR_BILL' && !dc && !po && editable ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Already entered</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2 text-sm">
                    {scan.validation.duplicates.map((d) => (
                      <div key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {d.docType.replace('_', ' ').toLowerCase()}{' '}
                          <span className="font-mono">{d.docNo ?? 'draft'}</span> ({d.status?.toLowerCase()})
                        </span>
                        {review.existingDocId === d.id ? (
                          <Badge variant="success">Reconciling against this</Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void save({ existingDocId: d.id }).catch(() => undefined)}
                          >
                            Reconcile against this instead of creating a new one
                          </Button>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              <IssuesBox
                issues={issues}
                editable={editable}
                onAck={(k) => void save({ confirm: [k] }).catch(() => undefined)}
              />

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <History className="size-4" /> History
                  </CardTitle>
                  <Button size="sm" variant="ghost" onClick={() => setShowHistory((s) => !s)}>
                    {showHistory ? 'Hide' : 'Show'}
                  </Button>
                </CardHeader>
                {showHistory ? <EventsList id={scan.id} version={scan.version} /> : null}
              </Card>
            </>
          ) : !processing && scan.status !== 'FAILED' ? (
            <Card>
              <CardContent className="text-sm text-muted-foreground">
                Nothing has been extracted yet.
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {/* Action bar */}
      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 backdrop-blur lg:left-60">
        <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2.5">
          <span className="mr-auto text-xs text-muted-foreground">
            {scan.applied
              ? 'Draft created. Post or approve it from its own screen — scanning never posts.'
              : blocking.length
                ? `${blocking.length} problem${blocking.length > 1 ? 's' : ''} to resolve before the draft can be created`
                : scan.status === 'READY'
                  ? 'All checks passed'
                  : ''}
          </span>
          {editable || scan.status === 'FAILED' ? (
            <>
              <Button variant="ghost" className="text-destructive" onClick={() => setDiscarding(true)}>
                <Ban /> Discard
              </Button>
              <ReprocessButton scan={scan} onDone={(s) => qc.setQueryData(key, s)} />
            </>
          ) : null}
          {editable ? (
            <Button
              variant="secondary"
              disabled={!dirty}
              loading={saving}
              onClick={() => void save().catch(() => undefined)}
            >
              <Save /> Save{dirty ? ` (${editCount(edits)})` : ''}{' '}
              <kbd className="ml-1 text-[10px] opacity-60">Ctrl+S</kbd>
            </Button>
          ) : null}
          {po && editable && can('scans.apply') && can('orders.create') ? (
            <Button
              disabled={dirty || scan.status !== 'READY'}
              title={
                dirty
                  ? 'Save your changes first'
                  : scan.status !== 'READY'
                    ? 'Resolve the problems listed first'
                    : 'Opens the order form filled from this PO'
              }
              onClick={() => navigate(`/orders/new?fromScan=${scan.id}`)}
            >
              <CheckCircle2 /> Create order
            </Button>
          ) : null}
          {!po && editable && can('scans.apply') && spec && can(spec.createPermission) ? (
            <Button
              disabled={dirty || scan.status !== 'READY'}
              loading={applying}
              title={
                dirty
                  ? 'Save your changes first'
                  : scan.status !== 'READY'
                    ? 'Resolve the problems listed first'
                    : undefined
              }
              onClick={async () => {
                setApplying(true);
                try {
                  const s = await api.post<ScanDetail>(`/invoice-scans/${scan.id}/apply`, {
                    version: scan.version,
                  });
                  qc.setQueryData(key, s);
                  toast.success(
                    s.applied?.linkedExisting
                      ? 'Linked to the existing document'
                      : `Draft ${TARGET_LABEL[s.applied!.docType].toLowerCase()} created`,
                  );
                  if (s.applied) navigate(s.applied.route);
                } catch (e) {
                  toast.error(errorMessage(e));
                  void q.refetch();
                } finally {
                  setApplying(false);
                }
              }}
            >
              <CheckCircle2 />{' '}
              {review?.existingDocId
                ? 'Confirm reconciliation'
                : `Create draft ${TARGET_LABEL[target!].toLowerCase()}`}
            </Button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard this scan?"
        description="Nothing is created in Wewin. The file is kept for the retention period, then deleted."
        confirmLabel="Discard"
        destructive
        requireReason
        onConfirm={async (reason) => {
          try {
            const s = await api.post<ScanDetail>(`/invoice-scans/${scan.id}/discard`, { reason });
            qc.setQueryData(key, s);
            toast.success('Discarded');
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </div>
  );
}

function Section({
  title,
  children,
  collapsed,
}: {
  title: string;
  children: ReactNode;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">{title}</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Hide' : 'Show'}
        </Button>
      </CardHeader>
      {open ? <CardContent className="grid gap-2">{children}</CardContent> : null}
    </Card>
  );
}

function VendorBox({
  scan,
  edits,
  setEdits,
  editable,
  confirmed,
  toggleConfirm,
  label: title,
  buyer = false,
}: {
  scan: ScanDetail;
  edits: Edits;
  setEdits: (f: (e: Edits) => Edits) => void;
  editable: boolean;
  confirmed: Set<string>;
  toggleConfirm: (k: string) => void;
  label: string;
  /** Buyer PO: the party is picked from buyers. */
  buyer?: boolean;
}) {
  const v = scan.review!.vendor;
  const id = edits.vendorId !== undefined ? edits.vendorId : v.id;
  const label = v.candidates.find((c) => c.id === id)?.name ?? scan.vendorName ?? undefined;
  const state = edits.vendorId !== undefined ? 'CONFIRMED' : v.state;
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <Badge
          variant={
            state === 'AUTO' || state === 'CONFIRMED'
              ? 'success'
              : state === 'SUGGESTED'
                ? 'warning'
                : 'danger'
          }
        >
          {state === 'AUTO'
            ? 'Matched by GSTIN'
            : state === 'CONFIRMED'
              ? 'Confirmed'
              : state === 'SUGGESTED'
                ? 'Suggested — confirm'
                : 'Not matched'}
        </Badge>
      </div>
      <EntityPicker
        endpoint={buyer ? '/buyers' : '/vendors'}
        map={buyer ? pickers.buyer : pickers.vendor}
        value={id ?? ''}
        valueLabel={label}
        disabled={!editable}
        onChange={(o) => setEdits((e) => ({ ...e, vendorId: o?.id ?? null }))}
      />
      {editable && state === 'SUGGESTED' && !id && v.candidates.length ? (
        <div className="flex flex-wrap gap-1">
          {v.candidates.slice(0, 3).map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => setEdits((e) => ({ ...e, vendorId: c.id }))}
            >
              {c.name} <span className="text-muted-foreground">{Math.round(c.score * 100)}%</span>
            </Button>
          ))}
        </div>
      ) : null}
      {editable && v.state === 'SUGGESTED' && v.id && edits.vendorId === undefined ? (
        <Button
          size="sm"
          variant={confirmed.has('vendor') ? 'secondary' : 'outline'}
          className="h-7 w-fit"
          onClick={() => toggleConfirm('vendor')}
        >
          <Check /> {v.candidates[0]?.reason ?? 'Confirm'}
        </Button>
      ) : null}
      <span className="text-[11px] text-muted-foreground">
        New {buyer ? 'buyers are added in Masters › Buyers' : 'vendors are added in Masters › Vendors'} —
        scanning never creates or changes a master.
      </span>
    </div>
  );
}

function LinesBox({
  scan,
  edits,
  setEdits,
  editable,
  confirmed,
  toggleConfirm,
  focusField,
  save,
}: {
  scan: ScanDetail;
  edits: Edits;
  setEdits: (f: (e: Edits) => Edits) => void;
  editable: boolean;
  confirmed: Set<string>;
  toggleConfirm: (k: string) => void;
  focusField: (f: ScanField | undefined) => void;
  save: (extra?: Partial<Omit<ReviewPatch, 'version'>>) => Promise<unknown>;
}) {
  const review = scan.review!;
  const target = edits.target !== undefined ? edits.target : review.target;
  const spec = target ? TARGET_SPECS[target] : null;
  const itemType = spec?.itemType ?? null;
  // An outward D.C. may send yarn or fabric: the picker shows both.
  const itemQuery = spec?.alsoItemTypes?.length ? undefined : itemType ? { type: itemType } : undefined;
  const itemTypeLabel = spec
    ? [itemType, ...(spec.alsoItemTypes ?? [])].filter(Boolean).join(' / ').toLowerCase()
    : '';
  // A buyer PO's lines are colour × size cells, not Wewin items.
  const showItem = !spec?.po;
  const min = scan.minConfidence;
  const issues = scan.validation?.issues ?? [];
  const setLine = (n: number, patch: LineEdit) =>
    setEdits((e) => ({
      ...e,
      lines: {
        ...e.lines,
        [n]: { ...e.lines[n], ...patch, fields: { ...e.lines[n]?.fields, ...patch.fields } },
      },
    }));
  const val = (l: ReviewLine, k: LineField) =>
    edits.lines[l.lineNo]?.fields && k in edits.lines[l.lineNo]!.fields!
      ? (edits.lines[l.lineNo]!.fields![k] ?? '')
      : (l.fields[k].value ?? '');
  const cols: [LineField, string, string][] =
    target === 'ORDER'
      ? [
          ['colour', 'Colour', 'min-w-32'],
          ['size', 'Size', 'min-w-20'],
          ['qty', 'Pcs', 'min-w-24 text-right'],
          ['rate', 'Unit price', 'min-w-24 text-right'],
        ]
      : target === 'INWARD_DC'
        ? [
            ['description', 'Description', 'min-w-56'],
            ['qty', 'Kg', 'min-w-24 text-right'],
            ['unit', 'Unit', 'min-w-14'],
            ['rollNo', 'Roll no.', 'min-w-28'],
            ['lot', 'Lot', 'min-w-28'],
            ['colour', 'Colour', 'min-w-24'],
            ['gsm', 'GSM', 'min-w-14 text-right'],
            ['dia', 'Dia', 'min-w-14'],
          ]
        : target === 'OUTWARD_DC'
          ? [
              ['description', 'Description', 'min-w-56'],
              ['qty', 'Kg', 'min-w-24 text-right'],
              ['unit', 'Unit', 'min-w-14'],
              ['lot', 'Lot', 'min-w-28'],
              ['colour', 'Colour', 'min-w-24'],
              ['bags', 'Rolls', 'min-w-14 text-right'],
              ['rate', 'Value ₹/kg', 'min-w-24 text-right'],
            ]
          : [
              ['description', 'Description', 'min-w-64'],
              ['qty', 'Qty', 'min-w-24 text-right'],
              ['unit', 'Unit', 'min-w-16'],
              ['rate', 'Rate', 'min-w-24 text-right'],
              ['amount', 'Amount', 'min-w-28 text-right'],
              ['lot', 'Lot', 'min-w-28'],
              ['bags', 'Bags', 'min-w-14 text-right'],
            ];
  const first = cols[0]![0];
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">
          Lines · {review.lines.length} read
          {scan.extraction && scan.extraction.detectedRows !== review.lines.length
            ? ` of ${scan.extraction.detectedRows} rows seen`
            : ''}
        </CardTitle>
        {editable ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void save({ addLine: true }).catch(() => undefined)}
          >
            <Plus /> Add a missing line
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-1.5">Use</th>
              <th className="w-8 px-1">#</th>
              {cols.slice(0, 1).map(([, h]) => (
                <th key={h} className="px-1">
                  {h}
                </th>
              ))}
              {showItem ? (
                <th className="min-w-56 px-1">Wewin item {itemTypeLabel ? `(${itemTypeLabel})` : ''}</th>
              ) : null}
              {cols.slice(1).map(([, h, c]) => (
                <th key={h} className={cn('px-1', c.includes('right') && 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {review.lines.map((l) => {
              const le = edits.lines[l.lineNo];
              const include = le?.include ?? l.include;
              const itemId = le?.itemId !== undefined ? le.itemId : l.item.id;
              const itemState = le?.itemId !== undefined ? 'CONFIRMED' : l.item.state;
              const rowErr = issues.some(
                (i) => i.field.startsWith(`line:${l.lineNo}`) && i.level === 'ERROR' && !i.acknowledged,
              );
              return (
                <tr
                  key={l.lineNo}
                  className={cn(
                    'border-b align-top',
                    !include && 'opacity-50',
                    rowErr && include && 'bg-red-50/60 dark:bg-red-950/30',
                  )}
                >
                  <td className="px-2 py-1.5">
                    <Checkbox
                      aria-label={`Use line ${l.lineNo}`}
                      checked={include}
                      disabled={!editable}
                      onChange={(e) => setLine(l.lineNo, { include: e.target.checked })}
                    />
                  </td>
                  <td className="px-1 py-1.5 text-xs tabular-nums text-muted-foreground">{l.lineNo}</td>
                  <td className="min-w-40 px-1 py-1">
                    <CellInput
                      f={l.fields[first]}
                      value={val(l, first)}
                      min={min}
                      disabled={!editable}
                      onFocus={() => focusField(l.fields[first])}
                      onChange={(v) => setLine(l.lineNo, { fields: { [first]: v } })}
                      label={`Line ${l.lineNo} ${first}`}
                    />
                  </td>
                  {showItem ? (
                    <td className="min-w-60 px-1 py-1">
                      <div className="grid gap-1">
                        <EntityPicker
                          endpoint="/items"
                          query={itemQuery}
                          map={pickers.item}
                          value={itemId ?? ''}
                          valueLabel={l.item.candidates.find((c) => c.id === itemId)?.name}
                          disabled={!editable || !itemType}
                          invalid={!itemId && include}
                          onChange={(o) => setLine(l.lineNo, { itemId: o?.id ?? null })}
                        />
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge
                            variant={
                              itemState === 'AUTO' || itemState === 'CONFIRMED'
                                ? 'success'
                                : itemState === 'SUGGESTED'
                                  ? 'warning'
                                  : 'danger'
                            }
                          >
                            {itemState === 'AUTO'
                              ? 'Matched'
                              : itemState === 'CONFIRMED'
                                ? 'Confirmed'
                                : itemState === 'SUGGESTED'
                                  ? 'Suggested'
                                  : 'No match'}
                          </Badge>
                          {editable && itemState === 'SUGGESTED' && !itemId
                            ? l.item.candidates.slice(0, 2).map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  className="rounded border px-1 text-[11px] hover:bg-accent"
                                  title={c.reason}
                                  onClick={() => setLine(l.lineNo, { itemId: c.id })}
                                >
                                  {c.name} {Math.round(c.score * 100)}%
                                </button>
                              ))
                            : null}
                        </div>
                      </div>
                    </td>
                  ) : null}
                  {cols.slice(1).map(([k, , c]) => {
                    const fk = `line:${l.lineNo}:${k}`;
                    const f = l.fields[k];
                    const low = f.source === 'EXTRACTED' && ((f.confidence ?? 0) < min || f.corrected);
                    return (
                      <td key={k} className={cn('px-1 py-1', c.replace('text-right', ''))}>
                        <div className="flex items-center gap-0.5">
                          <CellInput
                            f={f}
                            value={val(l, k)}
                            min={min}
                            disabled={!editable}
                            className={c}
                            onFocus={() => focusField(f)}
                            onChange={(v) => setLine(l.lineNo, { fields: { [k]: v } })}
                            label={`Line ${l.lineNo} ${k}`}
                            confirmed={confirmed.has(fk)}
                          />
                          {low && editable && (k === 'qty' || k === 'rate') ? (
                            <button
                              type="button"
                              aria-label={`Confirm line ${l.lineNo} ${k}`}
                              title="I checked this value"
                              className={cn(
                                'rounded p-0.5',
                                confirmed.has(fk) ? 'text-emerald-600' : 'text-amber-600',
                              )}
                              onClick={() => toggleConfirm(fk)}
                            >
                              <Check className="size-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!review.lines.length ? (
          <p className="p-3 text-sm text-muted-foreground">
            No lines were recognised. Add them, or reprocess the document.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CellInput({
  f,
  value,
  min,
  disabled,
  onChange,
  onFocus,
  className,
  label,
  confirmed,
}: {
  f: ScanField;
  value: string;
  min: number;
  disabled: boolean;
  onChange: (v: string) => void;
  onFocus: () => void;
  className?: string;
  label: string;
  confirmed?: boolean;
}) {
  const low = f.source === 'EXTRACTED' && ((f.confidence ?? 0) < min || f.corrected) && !confirmed;
  return (
    <input
      aria-label={label}
      title={
        f.source === 'EXTRACTED' && f.confidence !== null
          ? `Read with ${Math.round(f.confidence * 100)}% confidence${f.raw && f.raw !== f.value ? ` · printed “${f.raw}”` : ''}`
          : f.source === 'EDITED'
            ? 'Edited'
            : f.source === 'MISSING'
              ? 'Not found on the document'
              : undefined
      }
      value={value}
      disabled={disabled}
      onFocus={onFocus}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-8 w-full rounded border border-input bg-background px-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-70',
        low && 'border-amber-400 bg-amber-50 dark:bg-amber-950/40',
        f.source === 'EDITED' && 'border-emerald-400',
        className?.includes('text-right') && 'text-right tabular-nums',
      )}
    />
  );
}

function SourcesBox({
  scan,
  editable,
  save,
}: {
  scan: ScanDetail;
  editable: boolean;
  save: (extra?: Partial<Omit<ReviewPatch, 'version'>>) => Promise<unknown>;
}) {
  const review = scan.review!;
  const cands = useQuery({
    queryKey: ['invoice-scan-sources', scan.id, review.vendor.id],
    queryFn: () =>
      api.get<
        {
          sourceType: 'INWARD_DC' | 'PANEL_IN';
          sourceId: string;
          docNo: string;
          docDate: string;
          processName: string;
          qty: string;
          unit: string;
          rate: string | null;
          expected: string | null;
          vendorDcNo?: string | null;
        }[]
      >(`/invoice-scans/${scan.id}/sources`),
    enabled: editable && !!review.vendor.id,
  });
  const chosen = new Set(review.sources.map((s) => s.sourceId));
  const [sel, setSel] = useState<Set<string> | null>(null);
  const current = sel ?? chosen;
  const confirmed = review.confirmed.includes('sources');
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">D.C.s this invoice covers</CardTitle>
        {confirmed ? (
          <Badge variant="success">Confirmed</Badge>
        ) : review.sources.length ? (
          <Badge variant="warning">Matched from “DC No” — confirm</Badge>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {!review.vendor.id ? <p className="text-muted-foreground">Pick the vendor first.</p> : null}
        {!editable
          ? review.sources.map((s) => (
              <div key={s.sourceId} className="font-mono">
                {s.docNo} <span className="font-sans text-xs text-muted-foreground">{s.reason}</span>
              </div>
            ))
          : (cands.data ?? []).map((c) => (
              <label key={c.sourceId} className="flex items-center gap-2">
                <Checkbox
                  checked={current.has(c.sourceId)}
                  onChange={(e) => {
                    const n = new Set(current);
                    if (e.target.checked) n.add(c.sourceId);
                    else n.delete(c.sourceId);
                    setSel(n);
                  }}
                />
                <span className="font-mono">{c.docNo}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(c.docDate)} · {c.processName} · {c.qty} {c.unit.toLowerCase()}{' '}
                  {c.vendorDcNo ? `· their D.C. ${c.vendorDcNo}` : ''}
                </span>
                <span className="ml-auto tabular-nums">{c.expected ? formatInr(c.expected) : 'no rate'}</span>
              </label>
            ))}
        {editable && cands.data && !cands.data.length ? (
          <p className="text-muted-foreground">This vendor has no posted, unbilled D.C.s.</p>
        ) : null}
        {editable ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={confirmed && !sel ? 'secondary' : 'default'}
              disabled={!current.size}
              onClick={() =>
                void save({
                  sources: (cands.data ?? [])
                    .filter((c) => current.has(c.sourceId))
                    .map((c) => ({ sourceType: c.sourceType, sourceId: c.sourceId })),
                  confirm: ['sources'],
                })
                  .then(() => setSel(null))
                  .catch(() => undefined)
              }
            >
              <Check /> Confirm these D.C.s
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Outward D.C.: the program process is not printed on a D.C. — the reviewer picks it. */
function ProgramProcessBox({
  scan,
  editable,
  save,
}: {
  scan: ScanDetail;
  editable: boolean;
  save: (extra?: Partial<Omit<ReviewPatch, 'version'>>) => Promise<unknown>;
}) {
  const review = scan.review!;
  const opts = useQuery({
    queryKey: ['invoice-scan-pp', scan.id, review.vendor.id],
    queryFn: () =>
      api.get<{ id: string; label: string; planned: boolean }[]>(
        `/invoice-scans/${scan.id}/program-processes`,
      ),
    enabled: !!review.vendor.id,
  });
  const issue = scan.validation?.issues.find((i) => i.field === 'programProcessId' && !i.acknowledged);
  return (
    <Card className={cn(issue && 'ring-1 ring-red-200 dark:ring-red-900')}>
      <CardContent className="grid gap-1">
        <label htmlFor="scan-pp" className="text-xs font-medium text-muted-foreground">
          Program process *{' '}
          <span className="font-normal">(not printed on a D.C. — choose what this material is sent for)</span>
        </label>
        <Select
          id="scan-pp"
          value={review.programProcessId ?? ''}
          disabled={!editable || !review.vendor.id}
          onChange={(e) => void save({ programProcessId: e.target.value || null }).catch(() => undefined)}
        >
          <option value="">
            {!review.vendor.id
              ? 'Pick the job worker first'
              : opts.isLoading
                ? 'Loading…'
                : opts.data?.length
                  ? '— choose —'
                  : 'No approved program process is open for this job worker'}
          </option>
          {(opts.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.planned ? '★ ' : ''}
              {o.label}
            </option>
          ))}
        </Select>
        <span className="text-[11px] text-muted-foreground">
          ★ = this job worker is the planned vendor on the program. The draft still needs management approval
          before posting.
        </span>
      </CardContent>
    </Card>
  );
}

interface OutwardCandidate {
  sourceType: 'OUTWARD_DC';
  sourceId: string;
  docNo: string;
  docDate: string;
  processName: string;
  orderNo: string;
  sentKg: string;
  pendingKg: string;
  lots: string[];
}

/** Inward D.C.: our posted outward D.C.s the rolls come back against, with the kg counted against each. */
function OutwardLinksBox({
  scan,
  editable,
  save,
}: {
  scan: ScanDetail;
  editable: boolean;
  save: (extra?: Partial<Omit<ReviewPatch, 'version'>>) => Promise<unknown>;
}) {
  const review = scan.review!;
  const cands = useQuery({
    queryKey: ['invoice-scan-sources', scan.id, review.vendor.id],
    queryFn: () => api.get<OutwardCandidate[]>(`/invoice-scans/${scan.id}/sources`),
    enabled: !!review.vendor.id,
  });
  const chosen = useMemo(
    () => new Map(review.sources.map((s) => [s.sourceId, s.kg ?? ''])),
    [review.sources],
  );
  const [sel, setSel] = useState<Map<string, string> | null>(null);
  useEffect(() => setSel(null), [scan.version]);
  const current = sel ?? chosen;
  const confirmed = review.confirmed.includes('sources');
  const rollsKg = review.lines
    .filter((l) => l.include)
    .reduce(
      (a, l) =>
        l.fields.qty.value && /^\d+(\.\d+)?$/.test(l.fields.qty.value) ? a.plus(D(l.fields.qty.value)) : a,
      D(0),
    );
  const issues = (scan.validation?.issues ?? []).filter((i) => i.field === 'sources' && !i.acknowledged);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Received against our outward D.C.s</CardTitle>
        {confirmed && !sel ? (
          <Badge variant="success">Confirmed</Badge>
        ) : review.sources.length ? (
          <Badge variant="warning">Matched from “Your D.C. No” — confirm</Badge>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {!review.vendor.id ? <p className="text-muted-foreground">Pick the job worker first.</p> : null}
        {(cands.data ?? []).map((c) => {
          const on = current.has(c.sourceId);
          return (
            <div key={c.sourceId} className="flex flex-wrap items-center gap-2">
              <Checkbox
                aria-label={`Link ${c.docNo}`}
                checked={on}
                disabled={!editable}
                onChange={(e) => {
                  const n = new Map(current);
                  if (e.target.checked) n.set(c.sourceId, '');
                  else n.delete(c.sourceId);
                  setSel(n);
                }}
              />
              <span className="font-mono">{c.docNo}</span>
              <span className="text-xs text-muted-foreground">
                {formatDate(c.docDate)} · {c.orderNo} · {c.processName} · sent {c.sentKg} kg
                {c.lots.length ? ` · lot ${c.lots.join(', ')}` : ''}
              </span>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                pending {c.pendingKg} kg
              </span>
              {on ? (
                <Input
                  aria-label={`Kg against ${c.docNo}`}
                  placeholder="auto"
                  className="h-7 w-24 text-right tabular-nums"
                  inputMode="decimal"
                  disabled={!editable}
                  value={current.get(c.sourceId) ?? ''}
                  onChange={(e) => setSel(new Map(current).set(c.sourceId, e.target.value))}
                />
              ) : null}
            </div>
          );
        })}
        {cands.data && !cands.data.length ? (
          <p className="text-muted-foreground">No posted outward D.C. has kg pending at this job worker.</p>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          Rolls on this D.C.: {rollsKg.toFixed(3)} kg. Leave kg blank to split it automatically by what is
          pending (in the order shown).
        </p>
        {issues.map((i) => (
          <div
            key={i.code + i.message}
            className={cn(
              'flex items-start gap-2 text-xs',
              i.level === 'ERROR' ? 'text-red-700 dark:text-red-400' : 'text-amber-800 dark:text-amber-300',
            )}
          >
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {i.message}
          </div>
        ))}
        {editable ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={confirmed && !sel ? 'secondary' : 'default'}
              disabled={!current.size}
              onClick={() =>
                void save({
                  sources: [...current.entries()].map(([sourceId, kg]) => ({
                    sourceType: 'OUTWARD_DC' as const,
                    sourceId,
                    kg: kg.trim() ? kg.trim() : null,
                  })),
                  confirm: ['sources'],
                })
                  .then(() => setSel(null))
                  .catch(() => undefined)
              }
            >
              <Check /> Confirm these D.C.s
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Reconciliation({ r }: { r: NonNullable<ScanDetail['validation']>['reconciliation'] }) {
  const row = (l: string, v: string | null, strong = false) => (
    <div className={cn('flex justify-between', strong && 'font-semibold')}>
      <span className="text-muted-foreground">{l}</span>
      <span className="tabular-nums">{v === null ? '—' : formatInr(v)}</span>
    </div>
  );
  const diff = r.difference ? Number(r.difference) : null;
  return (
    <div className="mt-2 grid gap-1 rounded-md border p-2 text-sm sm:max-w-sm">
      {row('Lines add up to', r.linesTotal)}
      {row('Taxable value', r.taxable)}
      {row('Tax', r.taxTotal)}
      {r.charges !== '0.00' ? row('Freight / packing / other', r.charges) : null}
      {row('Calculated total', r.computedTotal, true)}
      {row('Total on the invoice', r.statedTotal, true)}
      {diff !== null ? (
        <div
          className={cn(
            'flex justify-between font-semibold',
            diff === 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400',
          )}
        >
          <span>Difference</span>
          <span className="tabular-nums">{formatInr(r.difference)}</span>
        </div>
      ) : null}
    </div>
  );
}

function IssuesBox({
  issues,
  editable,
  onAck,
}: {
  issues: Issue[];
  editable: boolean;
  onAck: (k: string) => void;
}) {
  if (!issues.length)
    return (
      <Card>
        <CardContent className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-4" /> No problems found
        </CardContent>
      </Card>
    );
  const order = { ERROR: 0, WARNING: 1, INFO: 2 } as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Checks</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1.5 text-sm">
        {[...issues]
          .sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged) || order[a.level] - order[b.level])
          .map((i, n) => (
            <div
              key={`${i.code}-${i.field}-${n}`}
              className={cn('flex items-start gap-2', i.acknowledged && 'opacity-60')}
            >
              {i.level === 'ERROR' ? (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-600" />
              ) : i.level === 'WARNING' ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              ) : (
                <Info className="mt-0.5 size-4 shrink-0 text-sky-600" />
              )}
              <span className="flex-1">
                {i.message}
                {i.acknowledged ? (
                  <span className="ml-1 text-xs text-muted-foreground">(acknowledged)</span>
                ) : null}
              </span>
              {editable && i.ackKey && !i.acknowledged ? (
                <Button size="sm" variant="outline" className="h-7" onClick={() => onAck(i.ackKey!)}>
                  Accept as printed
                </Button>
              ) : null}
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

function EventsList({ id, version }: { id: string; version: number }) {
  const q = useQuery({
    queryKey: ['invoice-scan-events', id, version],
    queryFn: () => api.get<ScanEvent[]>(`/invoice-scans/${id}/events`),
  });
  const show = (v: { value: unknown } | null) =>
    v === null ? '' : typeof v.value === 'string' ? v.value : JSON.stringify(v.value);
  return (
    <CardContent className="grid max-h-72 gap-1 overflow-y-auto text-xs">
      {(q.data ?? []).map((e) => (
        <div key={e.id} className="grid grid-cols-[9rem_1fr] gap-2 border-b py-1 last:border-0">
          <span className="text-muted-foreground">{formatDateTimeIst(e.createdAt)}</span>
          <span>
            <span className="font-medium">{e.kind.replace(/_/g, ' ').toLowerCase()}</span>
            {e.field ? <span className="font-mono"> {e.field}</span> : null}
            {e.before || e.after ? (
              <span className="text-muted-foreground">
                {' '}
                {e.before ? `“${show(e.before)}” → ` : ''}“{show(e.after)}”
              </span>
            ) : null}
            {e.note ? <span className="text-muted-foreground"> · {e.note}</span> : null}
          </span>
        </div>
      ))}
    </CardContent>
  );
}

function ReprocessButton({ scan, onDone }: { scan: ScanDetail; onDone: (s: ScanDetail) => void }) {
  const [busy, setBusy] = useState(false);
  const go = async (mode: 'local' | 'ai') => {
    setBusy(true);
    try {
      onDone(await api.post<ScanDetail>(`/invoice-scans/${scan.id}/reprocess`, { mode }));
      toast.success('Reprocessing — your corrections are kept');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="outline" loading={busy} onClick={() => void go('local')}>
        <RefreshCw /> Reprocess
      </Button>
      {scan.aiAvailable ? (
        <Button
          variant="outline"
          loading={busy}
          onClick={() => void go('ai')}
          title="Send the document to the configured AI service for extraction"
        >
          <Sparkles /> Reprocess with AI
        </Button>
      ) : null}
    </>
  );
}
