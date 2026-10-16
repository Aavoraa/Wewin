import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DataTable } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';

interface Alias {
  id: string;
  vendorName: string;
  sampleDescription: string;
  itemLabel: string;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED';
  timesConfirmed: number;
  version: number;
  createdAt: string;
  decidedAt: string | null;
}

/**
 * Vendor wording learned from reviewers' confirmations. A proposal is only a suggestion until
 * someone with approval rights approves it; then invoices from that vendor match automatically.
 */
export function AliasesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('PROPOSED');
  const decide = async (a: Alias, action: 'approve' | 'reject') => {
    try {
      await api.post(`/vendor-item-aliases/${a.id}/${action}`, { version: a.version });
      toast.success(action === 'approve' ? 'Approved — future invoices will match automatically' : 'Rejected');
      void qc.invalidateQueries({ queryKey: ['vendor-item-aliases'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div>
      <PageHeader title="Learned item descriptions" description="How vendors describe Wewin items on their invoices, learned when a reviewer confirms a match. Approved entries are used for automatic matching for that vendor only." />
      <DataTable<Alias>
        id="vendor-item-aliases"
        endpoint="/vendor-item-aliases"
        filters={{ status: status || undefined }}
        filterBar={
          <Select className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="PROPOSED">Awaiting approval</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="">All</option>
          </Select>
        }
        columns={[
          { key: 'vendorName', header: 'Vendor' },
          { key: 'sampleDescription', header: 'Invoice wording' },
          { key: 'itemLabel', header: 'Wewin item' },
          { key: 'timesConfirmed', header: 'Confirmed', type: 'int' },
          { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status === 'PROPOSED' ? 'PENDING' : r.status === 'APPROVED' ? 'APPROVED' : 'CANCELLED'} /> },
          ...(can('scans.aliases.approve')
            ? [
                {
                  key: '_act',
                  header: '',
                  noExport: true,
                  cell: (r: Alias) =>
                    r.status === 'PROPOSED' ? (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => void decide(r, 'approve')}>
                          <Check /> Approve
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void decide(r, 'reject')}>
                          <X /> Reject
                        </Button>
                      </div>
                    ) : null,
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
