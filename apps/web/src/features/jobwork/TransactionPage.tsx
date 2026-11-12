import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { RatesPage } from '../accounts/RatesPage';
import { InwardDcsPage } from './InwardPages';
import { OutwardDcsPage } from './OutwardPages';
import { YarnProgramsPage } from './YarnProgramPages';

/**
 * Desktop Transaction menu (Q-071): one screen per process with the desktop's four entries —
 * Rate Quotation (rate contracts), Delivery (outward D.C.s), Inward / Return (inward D.C.s) and
 * Job Close (open outward D.C.s, closed from the D.C.) — each showing that process only.
 */
export const TRANSACTION_PROCESSES: { code: string; label: string; material: 'Yarn' | 'Fabric' }[] = [
  { code: 'YARN_DYEING', label: 'Yarn Dyeing', material: 'Yarn' },
  { code: 'YARN_TWISTING', label: 'Yarn Twisting', material: 'Yarn' },
  { code: 'YARN_OTHER', label: 'Yarn Other Process', material: 'Yarn' },
  { code: 'KNITTING', label: 'Knitting', material: 'Yarn' },
  { code: 'GREY_PROCESS', label: 'Grey Process', material: 'Fabric' },
  { code: 'DYEING', label: 'Fabric Dyeing', material: 'Fabric' },
  { code: 'FABRIC_PRINTING', label: 'Printing', material: 'Fabric' },
  { code: 'FABRIC_OTHER', label: 'Fabric Other Process', material: 'Fabric' },
  { code: 'FABRIC_REPROCESS', label: 'Fabric Reprocess', material: 'Fabric' },
  { code: 'FABRIC_TO_YARN', label: 'Fabric to Yarn', material: 'Fabric' },
];

type Tab = 'rate' | 'program' | 'delivery' | 'inward' | 'close';

export function TransactionPage() {
  const { code } = useParams();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('delivery');
  const def = TRANSACTION_PROCESSES.find((x) => x.code === code);
  const q = useQuery({
    queryKey: ['picker', 'processes-all'],
    queryFn: () =>
      api.list<{ id: string; code: string; name: string }>('/processes', { pageSize: 100, active: 'all' }),
    staleTime: 5 * 60_000,
  });
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} />;
  const process = q.data?.data.find((x) => x.code === code);
  if (!def || !process)
    return <ErrorState error={new Error(`Process ${code ?? ''} is not set up in Masters › Processes`)} />;

  // Every process defines its programme (mixing, loss %) here before the delivery (Q-076).
  const tabs: [Tab, string][] = [
    ['rate', 'Rate Quotation'],
    ['program', 'Program Defined'],
    ['delivery', `${def.material} Delivery`],
    ['inward', `${def.material} Inward/Return`],
    ['close', 'Job Close'],
  ];
  return (
    <div>
      <PageHeader
        title={def.label}
        description={`${def.material} sent to job workers for ${def.label.toLowerCase()} and received back — rates, deliveries, inward / returns and closing the job.`}
        actions={
          can('jobwork.create') ? (
            <>
              <Button variant="outline" asChild>
                <Link to="/inward-dcs/new">
                  <Plus /> {def.material} Inward/Return
                </Link>
              </Button>
              <Button asChild>
                <Link to="/outward-dcs/new">
                  <Plus /> {def.material} Delivery
                </Link>
              </Button>
            </>
          ) : null
        }
      />
      <div className="mb-3 flex gap-1 border-b">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === k
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'rate' ? (
        <RatesPage key={process.id} processId={process.id} title={`Rate Quotation — ${def.label}`} />
      ) : tab === 'program' ? (
        <YarnProgramsPage key={process.id} processId={process.id} processLabel={def.label} embedded />
      ) : tab === 'delivery' ? (
        <OutwardDcsPage key={process.id} processId={process.id} embedded />
      ) : tab === 'inward' ? (
        <InwardDcsPage key={process.id} processId={process.id} embedded />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            Deliveries still open at the job worker. Open one and use Close to close the job (the balance is
            written off with a reason).
          </p>
          <OutwardDcsPage key={`${process.id}-open`} processId={process.id} openOnly embedded />
        </>
      )}
    </div>
  );
}
