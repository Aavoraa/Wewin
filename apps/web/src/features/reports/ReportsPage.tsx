import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { fyRangeFor, todayIst } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTimeIst } from '@/lib/format';
import { cn } from '@/lib/utils';
import { formatCell } from '@/components/DataTable';
import { Field } from '@/components/DocumentForm';
import { EntityPicker } from '@/components/EntityPicker';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { pickers } from '../orders/api';
import { processPicker } from '../accounts/RatesPage';

interface ParamDef {
  key: string;
  label: string;
  type: 'date' | 'vendor' | 'buyer' | 'process' | 'select';
  options?: { value: string; label: string }[];
  default?: 'fyStart' | 'today';
}
interface ReportMeta {
  key: string;
  title: string;
  description: string;
  group: string;
  permission: string;
  params: ParamDef[];
  columns: { key: string; header: string; type?: string }[];
}
interface RunResult {
  title: string;
  columns: ReportMeta['columns'];
  total: number;
  truncated: boolean;
  rows: Record<string, unknown>[];
}
interface ExportRow {
  id: string;
  reportKey: string;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED';
  fileName: string | null;
  rowCount: number | null;
  error: string | null;
  createdAt: string;
  fileKey: string | null;
}

const get = (row: Record<string, unknown>, key: string) => key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), row);
const defaults = (r: ReportMeta) => Object.fromEntries(r.params.filter((p) => p.default).map((p) => [p.key, p.default === 'fyStart' ? fyRangeFor(todayIst()).start : todayIst()]));

/** Report list (A§11): filters, on-screen view, and Excel built in the background for any size. */
export function ReportsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const cat = useQuery({ queryKey: ['reports-catalogue'], queryFn: () => api.get<ReportMeta[]>('/reports-catalogue') });
  const selectedKey = search.get('report') ?? cat.data?.[0]?.key ?? null;
  const report = cat.data?.find((r) => r.key === selectedKey) ?? null;
  const [values, setValues] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [runKey, setRunKey] = useState(0);
  useEffect(() => {
    if (report) {
      setValues(defaults(report));
      setRunKey(0);
    }
  }, [report]);
  const query = useMemo(() => Object.fromEntries(Object.entries(values).filter(([, v]) => v)), [values]);
  const run = useQuery({ queryKey: ['report-run', report?.key, query, runKey], queryFn: () => api.get<RunResult>(`/reports/run/${report!.key}`, query), enabled: !!report && runKey > 0 });
  const exportsQ = useQuery({
    queryKey: ['report-exports'],
    queryFn: () => api.get<ExportRow[]>('/report-exports'),
    enabled: can('reports.export'),
    refetchInterval: (q) => (q.state.data?.some((e) => e.status === 'QUEUED' || e.status === 'RUNNING') ? 2000 : false),
  });
  const highlight = search.get('export');

  async function requestExport() {
    if (!report) return;
    try {
      await api.post('/report-exports', { reportKey: report.key, params: query });
      toast.success('Building the Excel file — you will be notified when it is ready');
      void qc.invalidateQueries({ queryKey: ['report-exports'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (cat.isLoading) return <LoadingState />;
  if (cat.error) return <ErrorState error={cat.error} onRetry={() => void cat.refetch()} />;
  if (!cat.data?.length) return <EmptyState title="No reports available" hint="Ask the owner for report access for your modules." />;
  const groups = [...new Set(cat.data.map((r) => r.group))];
  return (
    <div>
      <PageHeader title="Reports" description="Choose a report, set the filters and view it here, or download it as Excel (built in the background for any size)." />
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardContent className="grid gap-3 text-sm">
            {groups.map((g) => (
              <div key={g} className="grid gap-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</div>
                {cat.data
                  .filter((r) => r.group === g)
                  .map((r) => (
                    <button key={r.key} type="button" onClick={() => setSearch({ report: r.key })} className={cn('rounded px-2 py-1 text-left hover:bg-accent', r.key === report?.key && 'bg-primary/10 font-medium text-primary')}>
                      {r.title}
                    </button>
                  ))}
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="grid min-w-0 gap-4">
          {report ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{report.title}</CardTitle>
                <p className="text-sm text-muted-foreground">{report.description}</p>
              </CardHeader>
              <CardContent className="grid gap-3">
                {report.params.length ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {report.params.map((p) => (
                      <Field key={p.key} label={p.label}>
                        {p.type === 'date' ? (
                          <Input type="date" value={values[p.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))} />
                        ) : p.type === 'select' ? (
                          <Select value={values[p.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}>
                            <option value="">All</option>
                            {p.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <EntityPicker
                            endpoint={p.type === 'vendor' ? '/vendors' : p.type === 'buyer' ? '/buyers' : '/processes'}
                            map={p.type === 'vendor' ? pickers.vendor : p.type === 'buyer' ? pickers.buyer : processPicker}
                            value={values[p.key] ?? ''}
                            valueLabel={labels[p.key]}
                            placeholder="All"
                            onChange={(o) => {
                              setLabels((l) => ({ ...l, [p.key]: o?.label ?? '' }));
                              setValues((v) => ({ ...v, [p.key]: o?.id ?? '' }));
                            }}
                          />
                        )}
                      </Field>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setRunKey((k) => k + 1)} loading={run.isFetching}>
                    <Play /> Show report
                  </Button>
                  {can('reports.export') ? (
                    <Button variant="outline" onClick={() => void requestExport()}>
                      <FileSpreadsheet /> Download Excel
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {run.error ? <ErrorState error={run.error} /> : null}
          {run.data ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">
                  {run.data.total} row{run.data.total === 1 ? '' : 's'}
                  {run.data.truncated ? ` — showing the first ${run.data.rows.length}; download Excel for all` : ''}
                </CardTitle>
              </CardHeader>
              <CardContent className="max-h-[60vh] overflow-auto p-0">
                {run.data.rows.length ? (
                  <Table>
                    <THead className="sticky top-0 bg-card">
                      <TR>
                        {run.data.columns.map((c) => (
                          <TH key={c.key} className={cn(['kg', 'qty', 'money', 'rate', 'pct', 'int'].includes(c.type ?? '') && 'text-right')}>
                            {c.header}
                          </TH>
                        ))}
                      </TR>
                    </THead>
                    <TBody>
                      {run.data.rows.map((row, i) => (
                        <TR key={i}>
                          {run.data!.columns.map((c) => (
                            <TD key={c.key} className={cn('whitespace-nowrap', ['kg', 'qty', 'money', 'rate', 'pct', 'int'].includes(c.type ?? '') && 'text-right tabular-nums')}>
                              {formatCell(get(row, c.key), (c.type ?? 'text') as never)}
                            </TD>
                          ))}
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <p className="p-3 text-sm text-muted-foreground">No rows for these filters.</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          {can('reports.export') && exportsQ.data?.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Your Excel downloads (kept 7 days)</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                {exportsQ.data.map((e) => (
                  <div key={e.id} className={cn('flex flex-wrap items-center justify-between gap-2 rounded px-2 py-1', e.id === highlight && 'bg-primary/10')}>
                    <span>
                      {cat.data.find((r) => r.key === e.reportKey)?.title ?? e.reportKey} <span className="text-xs text-muted-foreground">· {formatDateTimeIst(e.createdAt)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {e.status === 'READY' && e.fileKey ? (
                        <Button size="sm" variant="outline" onClick={() => void api.download(`/report-exports/${e.id}/download`, undefined, e.fileName ?? 'report.xlsx').catch((err: unknown) => toast.error(errorMessage(err)))}>
                          <Download /> {e.rowCount} rows
                        </Button>
                      ) : e.status === 'READY' ? (
                        <span className="text-xs text-muted-foreground">Expired</span>
                      ) : e.status === 'FAILED' ? (
                        <span className="text-xs text-destructive">{e.error}</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Loader2 className="size-3 animate-spin" /> Building…
                        </span>
                      )}
                      <StatusBadge status={e.status} />
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
