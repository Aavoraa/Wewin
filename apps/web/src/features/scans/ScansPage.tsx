import { useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { FileUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { SCAN_TARGETS, type ScanTarget } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { STATUS_LABEL, type ScanDetail, type ScanRow, TARGET_LABEL } from './types';

const ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';
const STATUS_TONE: Record<string, 'info' | 'warning' | 'success' | 'danger' | 'default'> = {
  QUEUED: 'info',
  PROCESSING: 'info',
  NEEDS_REVIEW: 'warning',
  READY: 'success',
  APPLIED: 'success',
  FAILED: 'danger',
  DISCARDED: 'default',
};

export function ScanStatusBadge({ status }: { status: ScanRow['status'] }) {
  return (
    <Badge variant={STATUS_TONE[status] ?? 'default'}>
      {status === 'QUEUED' || status === 'PROCESSING' ? <Loader2 className="size-3 animate-spin" /> : null}
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** Upload invoices (drag-and-drop or browse) and the register of scanned documents. */
export function ScansPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [target, setTarget] = useState<ScanTarget | ''>((params.get('target') as ScanTarget) ?? '');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setBusy(true);
    let last: ScanDetail | null = null;
    for (const f of list) {
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`${f.name}: larger than 10 MB`);
        continue;
      }
      const fd = new FormData();
      fd.append('file', f);
      if (target) fd.append('target', target);
      try {
        last = await api.post<ScanDetail>('/invoice-scans', fd);
        toast.success(`${f.name} uploaded — reading it now`);
      } catch (e) {
        toast.error(`${f.name}: ${errorMessage(e)}`);
      }
    }
    setBusy(false);
    void qc.invalidateQueries({ queryKey: ['invoice-scans'] });
    if (last && list.length === 1) navigate(`/scans/${last.id}`);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
  }

  return (
    <div>
      <PageHeader
        title="Scan invoices"
        description="Upload a supplier or job-worker invoice, or a delivery challan. Wewin reads it, matches the vendor and items, checks the figures, and fills a draft yarn receipt, trims receipt, job-work bill, outward D.C. or inward D.C. for you to review."
        actions={
          can('scans.aliases.approve') || can('scans.view') ? (
            <Link to="/scans/learned" className="text-sm text-muted-foreground hover:text-foreground">
              Learned item descriptions →
            </Link>
          ) : null
        }
      />
      {can('scans.upload') ? (
        <Card className="mb-4">
          <CardContent>
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload invoice files"
              onClick={() => input.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                drag ? 'border-primary bg-primary/5' : 'border-input hover:border-primary/60',
              )}
            >
              {busy ? <Loader2 className="size-7 animate-spin text-muted-foreground" /> : <FileUp className="size-7 text-muted-foreground" />}
              <div className="text-sm font-medium">{busy ? 'Uploading…' : 'Drop invoices here, or click to choose files'}</div>
              <div className="text-xs text-muted-foreground">PDF (searchable or scanned), JPG or PNG · up to 10 MB each · multi-page invoices supported</div>
              <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => e.target.files && void upload(e.target.files)} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor="scan-target" className="text-muted-foreground">
                Document type
              </label>
              <Select id="scan-target" className="h-8 w-56" value={target} onChange={(e) => setTarget(e.target.value as ScanTarget | '')}>
                <option value="">Detect automatically</option>
                {SCAN_TARGETS.map((t) => (
                  <option key={t} value={t}>
                    {TARGET_LABEL[t]}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-muted-foreground">Scanning never changes stock or accounts — it only prepares a draft.</span>
            </div>
          </CardContent>
        </Card>
      ) : null}
      <DataTable<ScanRow>
        id="invoice-scans"
        endpoint="/invoice-scans"
        exportTitle="Scanned invoices"
        rowHref={(r) => `/scans/${r.id}`}
        filters={{ status: status || undefined }}
        filterBar={
          <Select className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All open & done</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        }
        columns={[
          { key: 'createdAt', header: 'Uploaded', type: 'datetime' },
          { key: 'originalName', header: 'File' },
          { key: 'target', header: 'Type', cell: (r) => (r.target ? TARGET_LABEL[r.target] : <span className="text-muted-foreground">—</span>) },
          { key: 'vendorName', header: 'Vendor' },
          { key: 'vendorInvoiceNo', header: 'Invoice no.' },
          { key: 'invoiceDate', header: 'Invoice date', type: 'date' },
          { key: 'totalAmount', header: 'Total', type: 'money' },
          { key: 'pageCount', header: 'Pages', type: 'int' },
          { key: 'status', header: 'Status', cell: (r) => <ScanStatusBadge status={r.status} /> },
        ]}
      />
    </div>
  );
}
