import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import { Button } from './ui/button';

/**
 * Delete an uploaded file (attachment, scanned invoice / D.C. / PO, Programme Entry screenshot) after a
 * confirmation. `endpoint` is the DELETE URL; the server refuses when a document was created from it.
 */
export function DeleteFileButton({
  endpoint,
  name,
  onDeleted,
  label,
  size = 'icon-sm',
}: {
  endpoint: string;
  name: string;
  onDeleted: () => void;
  label?: string;
  size?: 'icon-sm' | 'sm';
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size={size}
        variant="ghost"
        className="text-muted-foreground hover:text-destructive"
        aria-label={`Delete ${name}`}
        title="Delete this file"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Trash2 /> {label ?? null}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${name}?`}
        description="The file and anything read from it are removed. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await api.del(endpoint);
            toast.success(`${name} deleted`);
            onDeleted();
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </>
  );
}
