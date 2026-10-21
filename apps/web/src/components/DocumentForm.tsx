import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { type AttachmentOwner } from '@wewin/shared';
import { AttachmentsPanel } from './AttachmentsPanel';
import { type VoiceForm, useRegisterVoiceForm, useVoice, useVoiceConfig } from '@/lib/voice';
import { Ban, CheckCircle2, Lock, Mic, Printer, Save, Send, Trash2 } from 'lucide-react';
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
  /** Attachments panel: defaults from the register this form belongs to (backHref) and the :id route param. */
  attachTo?: { type: AttachmentOwner; id: string } | null;
  /** Voice filling of this form (Q-060): what can be said and how it is applied. Null when not editable. */
  voice?: VoiceForm | null;
}

const ATTACH_BY_ROUTE: Record<string, AttachmentOwner> = {
  '/orders': 'ORDER',
  '/yarn-receipts': 'YARN_RECEIPT',
  '/outward-dcs': 'OUTWARD_DC',
  '/inward-dcs': 'INWARD_DC',
  '/panel-out': 'PANEL_DC',
  '/panel-in': 'PANEL_DC',
  '/packing-lists': 'PACKING_LIST',
  '/trims-docs': 'TRIMS_DOC',
  '/vendor-bills': 'VENDOR_BILL',
  '/debit-notes': 'DEBIT_NOTE',
  '/payments': 'PAYMENT',
  '/export-invoices': 'EXPORT_INVOICE',
  '/shipments': 'SHIPMENT',
  '/buyer-receipts': 'BUYER_RECEIPT',
};

/**
 * Document pattern (A§9): header + line grid + action bar (Save draft / Post / Cancel / Print).
 * State changes are explicit actions; the API enforces every transition.
 */
export function DocumentForm(p: DocumentFormProps) {
  const { id: routeId } = useParams();
  const attachType = p.backHref ? ATTACH_BY_ROUTE[p.backHref] : undefined;
  const attach = p.attachTo === null ? null : (p.attachTo ?? (attachType && routeId && routeId !== 'new' ? { type: attachType, id: routeId } : null));
  const headerRef = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState<null | 'post' | 'cancel' | 'close' | 'delete'>(null);
  const isDraft = p.status === 'DRAFT';
  const editable = p.editable ?? (isDraft && p.canEdit !== false);
  const voice = useVoice();
  const voiceCfg = useVoiceConfig();
  const voiceForm = editable && p.voice ? p.voice : null;
  useRegisterVoiceForm(voiceForm);
  const voiceOn = !!voiceForm && !!voiceCfg.data?.enabled && !!voiceCfg.data?.ai;
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
        <div className="flex items-center gap-2">
          {voiceOn ? (
            <Button variant="outline" size="sm" onClick={voice.open} title="Say the document's contents (Alt+V)">
              <Mic /> Fill by voice
            </Button>
          ) : null}
          {p.extraActions}
        </div>
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
          {attach ? <AttachmentsPanel type={attach.type} id={attach.id} /> : null}
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
