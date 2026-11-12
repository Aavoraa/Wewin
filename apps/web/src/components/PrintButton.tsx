import { Printer } from 'lucide-react';
import { Button } from './ui/button';

/**
 * Print this page as shown (lists with their current filters, documents, reports). The app chrome,
 * buttons and paging are hidden by the print stylesheet; a company / page / date header is added.
 */
export function PrintButton({ label = 'Print', compact }: { label?: string; compact?: boolean }) {
  return (
    <Button
      type="button"
      variant={compact ? 'ghost' : 'outline'}
      size={compact ? 'icon' : 'default'}
      className="no-print"
      onClick={() => window.print()}
      aria-label={compact ? 'Print this page' : undefined}
      title="Print this page (Ctrl+P)"
    >
      <Printer /> {compact ? null : label}
    </Button>
  );
}
