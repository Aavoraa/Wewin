import { Badge, type BadgeVariant } from './ui/badge';

const MAP: Record<string, BadgeVariant> = {
  DRAFT: 'draft',
  POSTED: 'posted',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
  CONFIRMED: 'posted',
  APPROVED: 'success',
  PENDING_APPROVAL: 'warning',
  UNPAID: 'danger',
  PARTIAL: 'warning',
  PAID: 'success',
  ACTIVE: 'danger',
  ACKNOWLEDGED: 'warning',
  RESOLVED: 'success',
  READY: 'success',
  FAILED: 'danger',
  QUEUED: 'info',
  RUNNING: 'info',
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={MAP[status] ?? 'default'}>{status.replace(/_/g, ' ')}</Badge>;
}
