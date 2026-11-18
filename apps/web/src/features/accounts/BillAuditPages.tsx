import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, PauseCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DataTable } from '@/components/DataTable';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { docNoCol } from '../production/common';
import { type BillAuditStatus, type VendorBill } from './types';

/** Badge for one audit level of a bill (Q-078). */
export function AuditBadge({ status, label }: { status: BillAuditStatus; label?: string }) {
  if (status === 'PASSED') return <Badge variant="success">{label ? `${label} passed` : 'Passed'}</Badge>;
  if (status === 'HELD') return <Badge variant="danger">{label ? `${label} held` : 'Held'}</Badge>;
  return <Badge>{label ? `${label} pending` : 'Pending'}</Badge>;
}

const TITLE = { 1: 'Bills Passing 1st Audit', 2: 'Bill Passing 2nd Audit' } as const;

/**
 * Bills passing (Q-078): posted vendor bills waiting for the 1st audit, or (after it) the 2nd, final
 * audit. Each row opens the bill's check list; Pass moves it on, Hold keeps it here with a reason.
 */
export function BillAuditPage() {
  const level = useParams().level === '2' ? 2 : 1;
  const { can } = useAuth();
  const qc = useQueryClient();
  const [queue, setQueue] = useState<'PENDING' | 'HELD' | 'DONE'>('PENDING');
  const [acting, setActing] = useState<null | { bill: VendorBill; decision: 'PASS' | 'HOLD' }>(null);
  const allowed = can(level === 1 ? 'accounts.bill.audit1' : 'accounts.bill.audit2');
  const tableId = `bill-audit-${level}`;
  const audit = queue === 'DONE' ? (level === 1 ? 'PENDING2' : 'PASSED') : queue === 'HELD' ? 'HELD' : level === 1 ? 'PENDING1' : 'PENDING2';
  const mine = (b: VendorBill) => (level === 1 ? b.audit1Status : b.audit2Status);

  if (!allowed) return <EmptyState title="Not allowed" hint={`${TITLE[level]} needs its own permission.`} />;
  return (
    <div>
      <PageHeader
        title={TITLE[level]}
        description={
          level === 1
            ? 'Posted vendor bills waiting for the 1st audit. Open the check list, then pass the bill or hold it with a reason.'
            : 'Bills that passed the 1st audit, waiting for the 2nd (final) audit.'
        }
      />
      <DataTable<VendorBill>
        id={tableId}
        endpoint="/vendor-bills"
        exportTitle={TITLE[level]}
        rowHref={(r) => `/vendor-bills/${r.id}`}
        filters={{ audit }}
        filterBar={
          <Select className="h-9 w-44" value={queue} onChange={(e) => setQueue(e.target.value as typeof queue)} aria-label="Queue">
            <option value="PENDING">Waiting for this audit</option>
            <option value="HELD">Held (any audit)</option>
            <option value="DONE">{level === 1 ? 'Passed 1st audit' : 'Fully passed'}</option>
          </Select>
        }
        columns={[
          docNoCol(),
          { key: 'docDate', header: 'Date', type: 'date' },
          { key: 'vendor.name', header: 'Vendor' },
          { key: 'vendorInvoiceNo', header: 'Bill no.' },
          { key: 'figures.netPayable', header: 'Net payable', type: 'money' },
          { key: 'variance', header: 'Variance', type: 'money' },
          { key: 'audit1Status', header: '1st audit', cell: (r) => <AuditBadge status={r.audit1Status} /> },
          { key: 'audit2Status', header: '2nd audit', cell: (r) => <AuditBadge status={r.audit2Status} /> },
          {
            key: '_actions',
            header: '',
            noExport: true,
            cell: (r) => (
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" asChild>
                  <Link to={`/print/bill-check-list/${r.id}`} target="_blank">
                    <ClipboardList /> Check list
                  </Link>
                </Button>
                {mine(r) !== 'PASSED' && (level === 1 || r.audit1Status === 'PASSED') ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setActing({ bill: r, decision: 'PASS' })}>
                      <CheckCircle2 /> Pass
                    </Button>
                    {mine(r) !== 'HELD' ? (
                      <Button size="sm" variant="ghost" onClick={() => setActing({ bill: r, decision: 'HOLD' })}>
                        <PauseCircle /> Hold
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            ),
          },
        ]}
      />
      <ConfirmDialog
        open={!!acting}
        onOpenChange={(o) => (o ? null : setActing(null))}
        title={acting ? `${acting.decision === 'PASS' ? 'Pass' : 'Hold'} bill ${acting.bill.docNo ?? ''} at the ${level === 1 ? '1st' : '2nd'} audit` : ''}
        description={
          acting?.decision === 'PASS'
            ? level === 1
              ? 'The bill moves to the 2nd audit.'
              : 'The bill is fully passed.'
            : 'The bill stays in this audit, marked held, until it is passed.'
        }
        confirmLabel={acting?.decision === 'PASS' ? 'Pass' : 'Hold'}
        requireReason={acting?.decision === 'HOLD'}
        reasonLabel="Why is it held?"
        onConfirm={async (reason) => {
          if (!acting) return;
          try {
            await api.post(`/vendor-bills/${acting.bill.id}/audit`, { level, decision: acting.decision, note: reason || undefined });
            toast.success(acting.decision === 'PASS' ? 'Passed' : 'Held');
            setActing(null);
            void qc.invalidateQueries({ queryKey: [tableId] });
            void qc.invalidateQueries({ queryKey: ['vendor-bills'] });
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </div>
  );
}
