import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { OPENING_KINDS, OPENING_TEMPLATES, type OpeningKind, type OpeningRowError, todayIst } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTimeIst } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/DocumentForm';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

interface Created {
  type: 'ORDER' | 'OUTWARD_DC' | 'VENDOR_BILL' | 'STOCK';
  id: string;
  docNo: string | null;
  label?: string;
}
interface OpeningImport {
  id: string;
  docNo: string | null;
  kind: OpeningKind;
  title: string;
  asOfDate: string;
  fileName: string;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  rowCount: number;
  problems: OpeningRowError[];
  created: Created[];
  createdAt: string;
  cancelReason: string | null;
}

const LINK: Record<Created['type'], string | null> = { ORDER: '/orders/', OUTWARD_DC: '/outward-dcs/', VENDOR_BILL: '/vendor-bills/', STOCK: null };
const NEXT: Record<OpeningKind, string> = {
  ORDERS: 'Check and confirm each draft order.',
  STOCK: 'Stock is now in the stores (Stock › Balances).',
  VENDOR_STOCK: 'Approve and post each draft outward D.C.; the material then shows at the job worker.',
  VENDOR_BALANCES: 'Opening bills are posted; they appear in ageing and can be paid.',
};

/** Go-live opening data (Q-027): download the template, upload, review problems, post. */
export function OpeningImportPage() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<OpeningKind>('ORDERS');
  const [asOf, setAsOf] = useState(todayIst());
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<OpeningImport | null>(null);
  const [cancelling, setCancelling] = useState<OpeningImport | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const history = useQuery({ queryKey: ['opening-imports'], queryFn: () => api.list<OpeningImport>('/opening-imports', { pageSize: 50 }) });
  const t = OPENING_TEMPLATES[kind];
  const refresh = () => void qc.invalidateQueries({ queryKey: ['opening-imports'] });

  async function upload(f: File) {
    setBusy(true);
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('asOfDate', asOf);
    fd.append('file', f);
    try {
      const r = await api.post<OpeningImport>('/opening-imports', fd);
      setCurrent(r);
      if (r.problems.length) toast.warning(`${r.problems.length} problem(s) to fix in the file`);
      else toast.success(`${r.rowCount} rows read — review and post`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }

  async function act(fn: () => Promise<OpeningImport | void>, done: string) {
    setBusy(true);
    try {
      const r = await fn();
      setCurrent(r ?? null);
      toast.success(done);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <PageHeader title="Opening data" description="One-time import at go-live: open orders, stock in stores, material at job workers and vendor balances." />
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">1 · Choose what to import</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {OPENING_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setCurrent(null);
                }}
                className={cn('rounded-md border p-3 text-left text-sm hover:bg-muted', k === kind && 'border-primary ring-1 ring-primary')}
              >
                <div className="font-medium">{OPENING_TEMPLATES[k].title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{OPENING_TEMPLATES[k].description}</div>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Button variant="outline" onClick={() => void api.download(`/opening-imports/templates/${kind}`, undefined, `opening-${kind.toLowerCase()}.xlsx`).catch((e) => toast.error(errorMessage(e)))}>
              <Download /> Download {t.title.toLowerCase()} template
            </Button>
            <Field label="Opening date (as of)">
              <Input type="date" value={asOf} max={todayIst()} onChange={(e) => setAsOf(e.target.value)} className="w-44" />
            </Field>
            <Button loading={busy} onClick={() => file.current?.click()}>
              <Upload /> Upload filled template
            </Button>
            <input ref={file} type="file" hidden accept=".xlsx" aria-label="Opening data file" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          </div>
        </CardContent>
      </Card>

      {current ? <ImportDetail imp={current} busy={busy} onPost={() => act(() => api.post(`/opening-imports/${current.id}/post`), 'Posted')} onDelete={() => act(() => api.del(`/opening-imports/${current.id}`).then(() => undefined), 'Upload discarded')} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Imports</CardTitle>
        </CardHeader>
        <CardContent>
          {history.data?.data.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>No.</TH>
                  <TH>What</TH>
                  <TH>As of</TH>
                  <TH>File</TH>
                  <TH className="text-right">Rows</TH>
                  <TH>Uploaded</TH>
                  <TH>Status</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {history.data.data.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium">{r.docNo ?? '—'}</TD>
                    <TD>{r.title}</TD>
                    <TD>{formatDate(r.asOfDate)}</TD>
                    <TD className="max-w-48 truncate">{r.fileName}</TD>
                    <TD className="text-right tabular-nums">{r.rowCount}</TD>
                    <TD>{formatDateTimeIst(r.createdAt)}</TD>
                    <TD>
                      <StatusBadge status={r.status} />
                    </TD>
                    <TD className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => void api.get<OpeningImport>(`/opening-imports/${r.id}`).then(setCurrent)}>
                        Open
                      </Button>
                      {r.status === 'POSTED' ? (
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(r)}>
                          Cancel
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState title="Nothing imported yet" />
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Cancel ${cancelling?.docNo ?? ''}?`}
        description="Undoes what this import created. Refused once those documents have moved on (orders confirmed, D.C.s posted, stock used, bills paid)."
        destructive
        requireReason
        confirmLabel="Cancel import"
        onConfirm={(reason) => act(() => api.post(`/opening-imports/${cancelling!.id}/cancel`, { reason }), 'Import cancelled').then(() => setCancelling(null))}
      />
    </div>
  );
}

function ImportDetail({ imp, busy, onPost, onDelete }: { imp: OpeningImport; busy: boolean; onPost(): void; onDelete(): void }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-sm">
          2 · {imp.title} — {imp.fileName} <StatusBadge status={imp.status} />
        </CardTitle>
        {imp.status === 'DRAFT' ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={onDelete}>
              Discard
            </Button>
            <Button size="sm" loading={busy} disabled={imp.problems.length > 0} onClick={onPost}>
              Post {imp.rowCount} rows
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="text-muted-foreground">
          As of {formatDate(imp.asOfDate)} · {imp.rowCount} rows read
          {imp.status === 'CANCELLED' && imp.cancelReason ? ` · cancelled: ${imp.cancelReason}` : ''}
        </p>
        {imp.problems.length ? (
          <div className="grid gap-2">
            <p className="font-medium text-destructive">Fix these in the file and upload it again — nothing has been saved to the books.</p>
            <Table>
              <THead>
                <TR>
                  <TH>Sheet</TH>
                  <TH className="text-right">Row</TH>
                  <TH>Column</TH>
                  <TH>Problem</TH>
                </TR>
              </THead>
              <TBody>
                {imp.problems.slice(0, 300).map((p, n) => (
                  <TR key={n}>
                    <TD>{p.sheet}</TD>
                    <TD className="text-right tabular-nums">{p.row || ''}</TD>
                    <TD>{p.field ?? ''}</TD>
                    <TD>{p.message}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : imp.status === 'DRAFT' ? (
          <p>No problems found. Posting creates everything in one step.</p>
        ) : null}
        {imp.created.length ? (
          <div className="grid gap-1">
            <p className="font-medium">
              Created {imp.docNo ? `by ${imp.docNo}` : ''} — {NEXT[imp.kind]}
            </p>
            <ul className="grid gap-0.5">
              {imp.created.map((c) => (
                <li key={`${c.type}${c.id}`}>
                  {LINK[c.type] ? (
                    <Link className="text-primary hover:underline" to={`${LINK[c.type]}${c.id}`}>
                      {c.docNo ?? 'Draft'} {c.label ? `· ${c.label}` : ''}
                    </Link>
                  ) : (
                    <span>{c.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
