import { Link } from 'react-router';
import { ScanText, Upload } from 'lucide-react';
import { type ScanTarget, isDcTarget } from '@wewin/shared';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

/** Entry point on a register: upload the supplier's invoice (or a paper D.C.) instead of typing it. */
export function ScanInvoiceButton({ target }: { target: ScanTarget }) {
  const { can } = useAuth();
  if (!can('scans.upload')) return null;
  const upload = isDcTarget(target) || target === 'ORDER';
  const label = target === 'ORDER' ? 'Upload buyer PO' : isDcTarget(target) ? 'Upload D.C.' : 'Scan invoice';
  return (
    <Button variant="outline" asChild>
      <Link to={`/scans?target=${target}`}>
        {upload ? <Upload /> : <ScanText />} {label}
      </Link>
    </Button>
  );
}
