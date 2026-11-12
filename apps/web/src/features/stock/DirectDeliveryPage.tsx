import { useState } from 'react';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { InwardDcsPage } from '../jobwork/InwardPages';
import { OutwardDcsPage } from '../jobwork/OutwardPages';

/**
 * Direct Delivery Receipt (Q-034 / Q-071): a job worker's output that goes straight to the next job
 * worker without coming to Wewin. Recorded as an inward D.C. kept at the job worker ("Hold at vendor"),
 * then an outward D.C. from that job worker to the next ("From vendor").
 */
export function DirectDeliveryPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'received' | 'sent'>('received');
  return (
    <div>
      <PageHeader
        title="Direct Delivery Receipt"
        description="Material passed straight from one job worker to the next (e.g. knitter → dyer). Receive it at the first job worker (inward D.C. with “Hold at vendor”), then send it on from there (outward D.C. with “From vendor”)."
        actions={
          can('jobwork.create') ? (
            <>
              <Button variant="outline" asChild>
                <Link to="/inward-dcs/new">
                  <Plus /> Receive at job worker
                </Link>
              </Button>
              <Button asChild>
                <Link to="/outward-dcs/new">
                  <Plus /> Send on to next job worker
                </Link>
              </Button>
            </>
          ) : null
        }
      />
      <div className="mb-3 flex gap-1 border-b">
        {(
          [
            ['received', 'Received at job worker'],
            ['sent', 'Sent on directly'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === k
                ? 'border-primary font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'received' ? <InwardDcsPage direct embedded /> : <OutwardDcsPage direct embedded />}
    </div>
  );
}
