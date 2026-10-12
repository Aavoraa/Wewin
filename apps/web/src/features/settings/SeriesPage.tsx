import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface Series {
  code: string;
  name: string;
  prefix: string;
  padding: number;
  isActive: boolean;
}
interface NumberRow {
  seriesCode: string;
  fyCode: string;
  lastNo: number;
}

/** Document series and the last number issued per financial year (numbers are assigned at posting). */
export function SeriesPage() {
  const s = useQuery({ queryKey: ['settings', 'series'], queryFn: () => api.get<Series[]>('/settings/series') });
  const n = useQuery({ queryKey: ['settings', 'number-series'], queryFn: () => api.get<NumberRow[]>('/settings/number-series') });
  if (s.isLoading || n.isLoading) return <LoadingState />;
  if (s.isError) return <ErrorState error={s.error} />;
  const last = new Map<string, NumberRow[]>();
  for (const r of n.data ?? []) last.set(r.seriesCode, [...(last.get(r.seriesCode) ?? []), r]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Document series" description="Format PREFIX/FY/NNNN. Numbers are gap-free per financial year and assigned only when a document is posted." />
      <Card className="overflow-hidden">
        <Table>
          <THead>
            <TR>
              <TH>Series</TH>
              <TH>Document</TH>
              <TH>Prefix</TH>
              <TH>Example</TH>
              <TH>Last issued</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {s.data?.map((r) => (
              <TR key={r.code}>
                <TD className="font-mono text-xs">{r.code}</TD>
                <TD>{r.name}</TD>
                <TD className="font-mono">{r.prefix}</TD>
                <TD className="font-mono text-xs">
                  {r.prefix}/26-27/{'1'.padStart(r.padding, '0')}
                </TD>
                <TD className="text-xs">
                  {(last.get(r.code) ?? []).map((x) => `${x.fyCode}: ${x.lastNo}`).join(' · ') || '—'}
                </TD>
                <TD>{r.isActive ? <Badge variant="success">Active</Badge> : <Badge>Inactive</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
