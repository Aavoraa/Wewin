import { Link } from 'react-router';
import { ScanText } from 'lucide-react';
import { type ScanTarget } from '@wewin/shared';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

/** Entry point on a register: upload the supplier's invoice instead of typing it. */
export function ScanInvoiceButton({ target }: { target: ScanTarget }) {
  const { can } = useAuth();
  if (!can('scans.upload')) return null;
  return (
    <Button variant="outline" asChild>
      <Link to={`/scans?target=${target}`}>
        <ScanText /> Scan invoice
      </Link>
    </Button>
  );
}
