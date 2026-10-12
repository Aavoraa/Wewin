import { useState, type ReactNode } from 'react';
import { Dialog, DialogContent } from './ui/dialog';
import { Button } from './ui/button';
import { Label, Textarea } from './ui/input';

/**
 * Confirmation for sensitive actions. With `requireReason`, a reason (min 3 chars) is captured and
 * passed to `onConfirm` — used for cancel / close / approve, which the API audits with the reason.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive,
  requireReason,
  reasonLabel = 'Reason',
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm(reason?: string): Promise<unknown> | void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = !requireReason || reason.trim().length >= 3;

  async function go() {
    if (!valid) return;
    setBusy(true);
    try {
      await onConfirm(requireReason ? reason.trim() : undefined);
      setReason('');
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title={title} description={description}>
        {children}
        {requireReason ? (
          <div className="mt-2 grid gap-1">
            <Label htmlFor="confirm-reason">{reasonLabel} *</Label>
            <Textarea
              id="confirm-reason"
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Required — recorded in the audit log"
            />
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Back
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => void go()}
            loading={busy}
            disabled={!valid}
            autoFocus={!requireReason}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
