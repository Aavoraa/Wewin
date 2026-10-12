import { useState, type ReactNode } from 'react';
import { useForm, type FieldValues, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ZodTypeAny } from 'zod';
import { Pencil, Plus, Power } from 'lucide-react';
import { toast } from 'sonner';
import { type PermissionKey } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DataTable, type DTColumn } from '@/components/DataTable';
import { PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { focusNextField } from '@/lib/hotkeys';

export interface MasterRow {
  id: string;
  isActive: boolean;
  version: number;
}

/**
 * Register + create/edit dialog for a master (vendors, buyers, items, processes…).
 * The same shared Zod schema validates the form here and the request on the API.
 */
export function MasterCrudPage<R extends MasterRow>(p: {
  id: string;
  title: string;
  description?: string;
  endpoint: string;
  columns: DTColumn<R>[];
  schema: ZodTypeAny;
  updateSchema: ZodTypeAny;
  editPerm?: PermissionKey;
  emptyForm: FieldValues;
  toForm: (row: R) => FieldValues;
  renderForm: (form: UseFormReturn<FieldValues, unknown, FieldValues>, editing: R | null) => ReactNode;
  filterBar?: ReactNode;
  filters?: Record<string, string | undefined>;
  dialogClassName?: string;
  noun: string;
  rowActions?: (row: R) => ReactNode;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const editable = can(p.editPerm ?? 'masters.edit');
  const [editing, setEditing] = useState<R | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState('true');

  const toggle = useMutation({
    mutationFn: (r: R) => api.post(`${p.endpoint}/${r.id}/${r.isActive ? 'deactivate' : 'activate'}`),
    onSuccess: () => {
      toast.success('Updated');
      void qc.invalidateQueries({ queryKey: [p.id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: DTColumn<R>[] = [
    ...p.columns,
    {
      key: 'isActive',
      header: 'Status',
      cell: (r) => (r.isActive ? <Badge variant="success">Active</Badge> : <Badge>Inactive</Badge>),
    },
    ...(editable
      ? [
          {
            key: '_actions',
            header: '',
            noExport: true,
            cell: (r: R) => (
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                {p.rowActions?.(r)}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Edit"
                  onClick={() => {
                    setEditing(r);
                    setOpen(true);
                  }}
                >
                  <Pencil />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={r.isActive ? 'Deactivate' : 'Activate'} title={r.isActive ? 'Deactivate' : 'Activate'} onClick={() => toggle.mutate(r)}>
                  <Power className={r.isActive ? 'text-destructive' : 'text-success'} />
                </Button>
              </div>
            ),
          } satisfies DTColumn<R>,
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title={p.title}
        description={p.description}
        actions={
          editable ? (
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus /> New {p.noun}
            </Button>
          ) : null
        }
      />
      <DataTable<R>
        id={p.id}
        endpoint={p.endpoint}
        columns={columns}
        exportTitle={p.title}
        filters={{ active, ...(p.filters ?? {}) }}
        filterBar={
          <>
            <Select className="h-9 w-32" value={active} onChange={(e) => setActive(e.target.value)} aria-label="Status filter">
              <option value="true">Active</option>
              <option value="false">Inactive</option>
              <option value="all">All</option>
            </Select>
            {p.filterBar}
          </>
        }
      />
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <MasterDialog
            key={editing?.id ?? 'new'}
            title={editing ? `Edit ${p.noun}` : `New ${p.noun}`}
            endpoint={p.endpoint}
            schema={editing ? p.updateSchema : p.schema}
            defaults={editing ? { ...p.toForm(editing), version: editing.version } : p.emptyForm}
            editing={editing}
            className={p.dialogClassName}
            render={p.renderForm}
            onDone={() => {
              setOpen(false);
              void qc.invalidateQueries({ queryKey: [p.id] });
              void qc.invalidateQueries({ queryKey: ['picker'] });
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function MasterDialog<R extends MasterRow>(p: {
  title: string;
  endpoint: string;
  schema: ZodTypeAny;
  defaults: FieldValues;
  editing: R | null;
  className?: string;
  render: (form: UseFormReturn<FieldValues, unknown, FieldValues>, editing: R | null) => ReactNode;
  onDone: () => void;
}) {
  const form = useForm<FieldValues, unknown, FieldValues>({ resolver: zodResolver(p.schema), defaultValues: p.defaults });
  const save = useMutation({
    mutationFn: (v: FieldValues) => (p.editing ? api.patch(`${p.endpoint}/${p.editing.id}`, v) : api.post(p.endpoint, v)),
    onSuccess: () => {
      toast.success('Saved');
      p.onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <DialogContent title={p.title} className={p.className ?? 'max-w-2xl'}>
      <form
        noValidate
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
        onKeyDown={(e) => {
          const t = e.target as HTMLElement;
          if (e.key === 'Enter' && !e.ctrlKey && t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox') {
            e.preventDefault();
            if (!focusNextField(t, e.currentTarget)) void form.handleSubmit((v) => save.mutate(v))();
          }
          if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            void form.handleSubmit((v) => save.mutate(v))();
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">{p.render(form, p.editing)}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
