import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DataTable } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';

interface Alert {
  id: string;
  kind: 'DC_OVERDUE' | 'GST_TIME_LIMIT' | 'PAYMENT_DUE';
  severity: string;
  title: string;
  message: string;
  docType: string | null;
  docId: string | null;
  docNo: string | null;
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

const KIND: Record<Alert['kind'], string> = { DC_OVERDUE: 'D.C. overdue', GST_TIME_LIMIT: 'GST time limit', PAYMENT_DUE: 'Payment due' };
const DOC_HREF: Record<string, string> = { OUTWARD_DC: '/outward-dcs', PANEL_OUT: '/panel-out', VENDOR_BILL: '/vendor-bills' };

/** Alerts raised by the scheduled checks (A§10): deduplicated, auto-resolved when the condition clears. */
export function AlertsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('OPEN');
  const [kind, setKind] = useState('');
  const [running, setRunning] = useState(false);

  async function runChecks() {
    setRunning(true);
    try {
      const dc = await api.post<{ overdue: { found: number; raised: number; resolved: number }; gst: { found: number; raised: number; resolved: number } }>('/alerts/check', { kind: 'DC' });
      const pay = await api.post<{ found: number; raised: number; resolved: number }>('/alerts/check', { kind: 'PAYMENT' });
      const raised = dc.overdue.raised + dc.gst.raised + pay.raised;
      const resolved = dc.overdue.resolved + dc.gst.resolved + pay.resolved;
      toast.success(`Checks done: ${raised} new, ${resolved} resolved`);
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  async function ack(a: Alert) {
    try {
      await api.post(`/alerts/${a.id}/acknowledge`);
      toast.success('Acknowledged');
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Alerts"
        description="Overdue job-work D.C.s, GST job-work time limits and vendor payments due. Checks run daily (08:00 / 08:15 IST); an alert closes itself when the condition clears."
        actions={
          can('alerts.manage') ? (
            <Button variant="outline" size="sm" onClick={() => void runChecks()} loading={running}>
              <RefreshCw /> Run checks now
            </Button>
          ) : null
        }
      />
      <DataTable<Alert>
        id="alerts"
        endpoint="/alerts"
        exportTitle="Alerts"
        filters={{ status: status || undefined, kind: kind || undefined }}
        filterBar={
          <>
            <Select className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="OPEN">Open</option>
              <option value="ACTIVE">Active</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="RESOLVED">Resolved</option>
              <option value="">All</option>
            </Select>
            <Select className="h-9 w-40" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
              <option value="">All kinds</option>
              {Object.entries(KIND).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </>
        }
        columns={[
          { key: 'severity', header: 'Severity', cell: (r) => <StatusBadge status={r.severity} /> },
          { key: 'kind', header: 'Kind', cell: (r) => KIND[r.kind] ?? r.kind },
          {
            key: 'title',
            header: 'Alert',
            cell: (r) => (
              <div>
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground">{r.message}</div>
              </div>
            ),
          },
          {
            key: 'docNo',
            header: 'Document',
            cell: (r) =>
              r.docId && r.docType && DOC_HREF[r.docType] ? (
                <Link to={`${DOC_HREF[r.docType]}/${r.docId}`} className="font-mono hover:underline" onClick={(e) => e.stopPropagation()}>
                  {r.docNo}
                </Link>
              ) : (
                r.docNo
              ),
          },
          { key: 'firstSeenAt', header: 'Since', type: 'datetime' },
          { key: 'status', header: 'Status', type: 'status' },
          ...(can('alerts.manage')
            ? [
                {
                  key: '_ack',
                  header: '',
                  noExport: true,
                  cell: (r: Alert) =>
                    r.status === 'ACTIVE' ? (
                      <Button size="sm" variant="ghost" onClick={() => void ack(r)}>
                        <Check /> Acknowledge
                      </Button>
                    ) : null,
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
