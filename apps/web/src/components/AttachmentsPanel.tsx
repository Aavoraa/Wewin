import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Paperclip, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, ATTACHMENT_OWNERS, type AttachmentOwner } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTimeIst } from '@/lib/format';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

interface Attachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
}

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Supporting files on a document (PDF, JPG, PNG, XLSX up to 10 MB). Files open only for users who can see the document. */
export function AttachmentsPanel({ type, id }: { type: AttachmentOwner; id: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const key = ['attachments', type, id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Attachment[]>('/attachments', { ownerType: type, ownerId: id }), enabled: can(ATTACHMENT_OWNERS[type]) });
  if (!can(ATTACHMENT_OWNERS[type])) return null;

  async function add(files: FileList) {
    setBusy(true);
    for (const f of [...files]) {
      if (f.size > ATTACHMENT_MAX_BYTES) {
        toast.error(`${f.name}: larger than 10 MB`);
        continue;
      }
      const fd = new FormData();
      fd.append('ownerType', type);
      fd.append('ownerId', id);
      fd.append('file', f);
      try {
        await api.post('/attachments', fd);
        toast.success(`${f.name} attached`);
      } catch (e) {
        toast.error(`${f.name}: ${errorMessage(e)}`);
      }
    }
    setBusy(false);
    if (input.current) input.current.value = '';
    void qc.invalidateQueries({ queryKey: key });
  }

  async function open(a: Attachment) {
    try {
      const blob = await api.blob(`/attachments/${a.id}/file`);
      const url = URL.createObjectURL(blob);
      if (a.mimeType.startsWith('image/') || a.mimeType === 'application/pdf') window.open(url, '_blank', 'noopener');
      else {
        const link = document.createElement('a');
        link.href = url;
        link.download = a.originalName;
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Paperclip className="size-4" /> Attachments {q.data?.length ? `(${q.data.length})` : ''}
        </CardTitle>
        {can('attachments.upload') ? (
          <>
            <Button size="sm" variant="outline" loading={busy} onClick={() => input.current?.click()}>
              <Paperclip /> Attach file
            </Button>
            <input ref={input} type="file" multiple hidden accept={ATTACHMENT_ACCEPT} aria-label="Attach files" onChange={(e) => e.target.files && void add(e.target.files)} />
          </>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-1 text-sm">
        {q.data?.length ? (
          q.data.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2">
              <button type="button" className="flex min-w-0 items-center gap-2 text-left hover:underline" onClick={() => void open(a)}>
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{a.originalName}</span>
              </button>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {size(a.sizeBytes)} · {a.uploadedBy} · {formatDateTimeIst(a.createdAt)}
                {can('attachments.upload') ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${a.originalName}`}
                    onClick={async () => {
                      try {
                        await api.del(`/attachments/${a.id}`);
                        void qc.invalidateQueries({ queryKey: key });
                      } catch (e) {
                        toast.error(errorMessage(e));
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </span>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">No files. PDF, JPG, PNG or XLSX up to 10 MB.</p>
        )}
      </CardContent>
    </Card>
  );
}
