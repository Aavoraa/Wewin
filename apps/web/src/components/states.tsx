import { type ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { Button } from './ui/button';
import { PrintButton } from './PrintButton';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
      <Inbox className="size-8 text-muted-foreground/60" />
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-muted-foreground">{hint}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center" role="alert">
      <AlertTriangle className="size-8 text-destructive" />
      <p className="text-sm font-medium">Could not load data</p>
      <p className="max-w-md text-xs text-muted-foreground">{errorMessage(error)}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  badge,
  printable = true,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
  /** Every page offers Print (prints the page as shown); off only where a page has its own print layout. */
  printable?: boolean;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          {title} {badge}
        </h1>
        {description ? <p className="no-print mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions || printable ? (
        <div className="no-print flex flex-wrap items-center gap-2">
          {printable ? <PrintButton /> : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
