import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Ban, CheckCircle2, Lock, Printer, Save, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api';
import { focusNextField, useDocumentHotkeys } from '@/lib/hotkeys';
import { formatDateTimeIst } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { ConfirmDialog } from './ConfirmDialog';
import { StatusBadge } from './StatusBadge';

export interface DocumentFormProps {
  title: string;
  docNo?: string | null;
  status: string;
  postedAt?: string | null;
  backHref?: string;
  /** Header fields (inputs). Enter moves to the next field. */
  header: ReactNode;
  /** Line grid. */
  lines?: ReactNode;
  /** Right-hand panel: totals, live loss badge, pending quantities. */
  aside?: ReactNode;
  /** Extra content below lines (linked documents, attachments, audit). */
  footer?: ReactNode;
  saving?: boolean;
  canEdit?: boolean;
  canPost?: boolean;
  canCancel?: boolean;
  canClose?: boolean;
  onSave?: () => Promise<unknown>;
  onPost?: () => Promise<unknown>;
  onCancel?: (reason: string) => Promise<unknown>;
  onClose?: (reason: string) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
  printHref?: string;
  postWarning?: ReactNode;
  closeDescription?: ReactNode;
  extraActions?: ReactNode;
  /** Override header editability (e.g. confirmed orders allow amendments). */
  editable?: boolean;
  /** Label of the primary state action: Post (default), Confirm, Approve… */
  postLabel?: string;
  postDescription?: ReactNode;
  /** Statuses in which Cancel / Close are offered (default POSTED). */
  cancelStatuses?: string[];
  closeStatuses?: string[];
  cancelDescription?: ReactNode;
}

/**
 * Document pattern (A§9): header + line grid + action bar (Save draft / Post / Cancel / Print).
 * State changes are explicit actions; the API enforces every transition.
 */
export function DocumentForm(p: DocumentFormProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState<null | 'post' | 'cancel' | 'close' | 'delete'>(null);
  const isDraft = p.status === 'DRAFT';
  const editable = p.editable ?? (isDraft && p.canEdit !== false);
  const postLabel = p.postLabel ?? 'Post';
  const cancelOk = (p.cancelStatuses ?? ['POSTED']).includes(p.status);
  const closeOk = (p.closeStatuses ?? ['POSTED']).includes(p.status);

  async function run(fn: (() => Promise<unknown>) | undefined, ok: string) {
    if (!fn) return;
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  }

  useDocumentHotkeys(
    {
      save: () => {
        if (editable && p.onSave) void run(p.onSave, 'Saved').catch(() => undefined);
      },
      post: () => {
        if (isDraft && p.canPost && p.onPost) setConfirm('post');
      },
    },
    true,
  );

  function onHeaderKey(e: KeyboardEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && t.tagName !== 'TEXTAREA' && t.tagName !== 'BUTTON') {
      e.preventDefault();
      focusNextField(t, headerRef.current, e.shiftKey);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {p.backHref ? (
            <Link to={p.backHref} className="text-sm text-muted-foreground hover:text-foreground">
              ← Back
            </Link>
          ) : null}
          <h1 className="text-lg font-semibold">
            {p.title} {p.docNo ? <span className="font-mono text-base text-muted-foreground">{p.docNo}</span> : null}
          </h1>
          <StatusBadge status={p.status} />
          {!editable && !isDraft ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="size-3" /> Read-only
              {p.postedAt ? ` · ${formatDateTimeIst(p.postedAt)}` : ''}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">{p.extraActions}</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardContent>
              <div ref={headerRef} onKeyDown={onHeaderKey}>
                <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {p.header}
                </fieldset>
              </div>
            </CardContent>
          </Card>
          {p.lines}
          {p.footer}
        </div>
        {p.aside ? <div className="flex flex-col gap-3">{p.aside}</div> : null}
      </div>

      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 backdrop-blur lg:left-60">
        <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2.5">
          {isDraft && p.onDelete ? (
            <Button variant="ghost" className="mr-auto text-destructive" onClick={() => setConfirm('delete')}>
              <Trash2 /> Delete draft
            </Button>
          ) : null}
          {p.printHref && !isDraft ? (
            <Button variant="outline" asChild>
              <Link to={p.printHref} target="_blank">
                <Printer /> Print
              </Link>
            </Button>
          ) : null}
          {closeOk && p.canClose && p.onClose ? (
            <Button variant="outline" onClick={() => setConfirm('close')}>
              <CheckCircle2 /> Close
            </Button>
          ) : null}
          {cancelOk && p.canCancel && p.onCancel ? (
            <Button variant="outline" className="text-destructive" onClick={() => setConfirm('cancel')}>
              <Ban /> Cancel document
            </Button>
          ) : null}
          {editable && p.onSave ? (
            <Button variant="secondary" onClick={() => void run(p.onSave, 'Saved').catch(() => undefined)} loading={p.saving}>
              <Save /> {isDraft ? 'Save draft' : 'Save changes'} <kbd className="ml-1 text-[10px] opacity-60">Ctrl+S</kbd>
            </Button>
          ) : null}
          {isDraft && p.canPost && p.onPost ? (
            <Button onClick={() => setConfirm('post')}>
              <Send /> {postLabel} <kbd className="ml-1 text-[10px] opacity-70">Ctrl+Enter</kbd>
            </Button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'post'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`${postLabel} ${p.title.toLowerCase()}?`}
        description={
          p.postDescription ??
          'Posting assigns the document number and updates stock and ledgers. A posted document cannot be edited; corrections need cancellation.'
        }
        confirmLabel={postLabel}
        onConfirm={() => run(p.onPost, `${postLabel} done`)}
      >
        {p.postWarning}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Cancel ${p.docNo ?? 'document'}?`}
        description={
          p.cancelDescription ??
          'Reversing entries will be written. The number is kept and marked CANCELLED. This is refused if later documents depend on it.'
        }
        confirmLabel="Cancel document"
        destructive
        requireReason
        onConfirm={(reason) => run(() => p.onCancel!(reason!), 'Cancelled')}
      />
      <ConfirmDialog
        open={confirm === 'close'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Close ${p.docNo ?? 'document'}?`}
        description={p.closeDescription ?? 'Closing settles the document. This cannot be undone.'}
        confirmLabel="Close"
        requireReason
        onConfirm={(reason) => run(() => p.onClose!(reason!), 'Closed')}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this draft?"
        description="Drafts have no number and no stock effect; deleting removes it permanently."
        confirmLabel="Delete draft"
        destructive
        onConfirm={() => run(p.onDelete, 'Draft deleted')}
      />
    </div>
  );
}

export function Field({ label, error, children, className }: { label: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {error ? <span className="mt-0.5 block text-[11px] text-destructive">{error}</span> : null}
    </label>
  );
}
