import { useState } from 'react';
import { type Resolver, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { type CompanySettingsInput, type UnitCreateInput, zExporterCreate, zExporterUpdate, zUnitCreate, zUnitUpdate } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { COMPANY_FIELDS } from './SettingsPage';

interface UnitRow {
  id: string;
  code: string;
  name: string;
  exporterId: string;
  docPrefix: string;
  isActive: boolean;
  version: number;
}
type ExporterRow = CompanySettingsInput & { id: string; code: string; isActive: boolean; isPlaceholder: boolean; units: UnitRow[] };

const MAIN_ID = '00000000-0000-4000-8000-000000000001';

function useSaved(msg: string) {
  const qc = useQueryClient();
  return () => {
    toast.success(msg);
    void qc.invalidateQueries({ queryKey: ['exporters'] });
    void qc.invalidateQueries({ queryKey: ['auth', 'units'] });
    void qc.invalidateQueries({ queryKey: ['settings'] });
    void qc.invalidateQueries({ queryKey: ['print'] });
  };
}

function FieldError({ msg }: { msg?: string }) {
  return msg ? <span className="text-[11px] text-destructive">{msg}</span> : null;
}

/** Add or edit an exporter: the legal entity printed on its units' documents. */
function ExporterDialog({ editing, onClose }: { editing: ExporterRow | null | 'new'; onClose: () => void }) {
  const isNew = editing === 'new';
  const row = isNew ? null : editing;
  type Form = CompanySettingsInput & { code?: string };
  const form = useForm<Form>({
    resolver: (isNew ? zodResolver(zExporterCreate) : zodResolver(zExporterUpdate)) as unknown as Resolver<Form>,
    values: row
      ? ({ ...row, lutValidFrom: row.lutValidFrom?.slice(0, 10) ?? '', lutValidTo: row.lutValidTo?.slice(0, 10) ?? '' } as Form)
      : ({ code: '', state: 'Tamil Nadu', stateCode: '33' } as Form),
  });
  const saved = useSaved(isNew ? 'Exporter added' : 'Exporter saved');
  const save = useMutation({
    mutationFn: (v: Form) => (row ? api.put(`/exporters/${row.id}`, v) : api.post('/exporters', v)),
    onSuccess: () => {
      saved();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const err = form.formState.errors as Record<string, { message?: string } | undefined>;
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={row ? `Edit exporter — ${row.code}` : 'Add exporter'} description="Letterhead, GSTIN, IEC, LUT and bank printed on documents of this exporter's units." className="max-w-3xl">
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {isNew ? (
            <div>
              <Label htmlFor="code">Code *</Label>
              <Input id="code" {...form.register('code')} />
              <FieldError msg={err.code?.message} />
            </div>
          ) : null}
          {COMPANY_FIELDS.map((f) => (
            <div key={f.key} className={f.span ? 'sm:col-span-2' : ''}>
              <Label htmlFor={`x-${f.key}`}>{f.label}</Label>
              <Input id={`x-${f.key}`} type={f.key.startsWith('lutValid') ? 'date' : 'text'} aria-invalid={!!err[f.key]} {...form.register(f.key)} />
              <FieldError msg={err[f.key]?.message} />
            </div>
          ))}
          <div className="flex justify-end sm:col-span-2 lg:col-span-4">
            <Button type="submit" loading={save.isPending}>
              {isNew ? 'Add exporter' : 'Save exporter'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Add a unit to an exporter, or rename one. Code and number prefix are fixed once created. */
function UnitDialog({ exporter, unit, onClose }: { exporter: ExporterRow | null; unit: UnitRow | null; onClose: () => void }) {
  const form = useForm<UnitCreateInput & { version?: number }>({
    resolver: (unit ? zodResolver(zUnitUpdate) : zodResolver(zUnitCreate)) as unknown as Resolver<UnitCreateInput & { version?: number }>,
    values: unit ? { ...unit } : { code: '', name: '', exporterId: exporter?.id ?? '', docPrefix: '' },
  });
  const saved = useSaved(unit ? 'Unit saved' : 'Unit added');
  const save = useMutation({
    mutationFn: (v: UnitCreateInput & { version?: number }) => (unit ? api.put(`/units/${unit.id}`, { name: v.name, version: v.version }) : api.post('/units', v)),
    onSuccess: () => {
      saved();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const err = form.formState.errors;
  return (
    <Dialog open={!!exporter || !!unit} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={unit ? `Edit unit — ${unit.code}` : `Add unit to ${exporter?.tradeName ?? exporter?.legalName ?? ''}`}
        description="A unit keeps its own documents, numbers, stock and reports. Users pick it at login."
      >
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="grid gap-3">
          <div>
            <Label htmlFor="u-code">Code *</Label>
            <Input id="u-code" disabled={!!unit} {...form.register('code')} />
            <FieldError msg={err.code?.message} />
          </div>
          <div>
            <Label htmlFor="u-name">Name *</Label>
            <Input id="u-name" placeholder="e.g. Unit 2 — Avinashi Road" {...form.register('name')} />
            <FieldError msg={err.name?.message} />
          </div>
          <div>
            <Label htmlFor="u-prefix">Document number prefix *</Label>
            <Input id="u-prefix" disabled={!!unit} placeholder="e.g. U2-" {...form.register('docPrefix')} />
            <span className="text-[11px] text-muted-foreground">Put in front of every number, e.g. U2-OD/25-26/0001. Cannot change later.</span>
            <FieldError msg={err.docPrefix?.message} />
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={save.isPending}>
              {unit ? 'Save unit' : 'Add unit'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Exporters & units master (Q-085): each unit works fully separately; the login picks one. */
export function ExportersPage() {
  const { can, user } = useAuth();
  const editable = can('settings.edit');
  const q = useQuery({ queryKey: ['exporters'], queryFn: () => api.get<ExporterRow[]>('/exporters') });
  const [exporterDlg, setExporterDlg] = useState<ExporterRow | null | 'new'>(null);
  const [unitFor, setUnitFor] = useState<ExporterRow | null>(null);
  const [unitEdit, setUnitEdit] = useState<UnitRow | null>(null);
  const saved = useSaved('Saved');
  const toggle = useMutation({
    mutationFn: (v: { path: string; isActive: boolean }) => api.post(v.path, { isActive: v.isActive }),
    onSuccess: saved,
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <PageHeader
        title="Exporters & units"
        description="Each unit has its own documents, document numbers, stock and reports. Users choose the exporter and unit when they log in; vendors, buyers, items and users are shared."
        actions={
          editable ? (
            <Button onClick={() => setExporterDlg('new')}>
              <Plus /> Add exporter
            </Button>
          ) : null
        }
      />
      {(q.data ?? []).map((x) => (
        <Card key={x.id}>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {x.tradeName ?? x.legalName} <span className="font-mono text-xs text-muted-foreground">{x.code}</span>
                {!x.isActive ? <Badge variant="danger">Inactive</Badge> : null}
                {x.isPlaceholder ? <Badge variant="warning">Placeholder — please complete</Badge> : null}
              </CardTitle>
              <CardDescription>
                {x.legalName} · GSTIN {x.gstin} · {x.city}, {x.state}
              </CardDescription>
            </div>
            {editable ? (
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setExporterDlg(x)}>
                  <Pencil /> Edit
                </Button>
                {x.id !== MAIN_ID ? (
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ path: `/exporters/${x.id}/active`, isActive: !x.isActive })}>
                    {x.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-2">
            <Table>
              <THead>
                <TR>
                  <TH>Unit</TH>
                  <TH>Code</TH>
                  <TH>Number prefix</TH>
                  <TH>Status</TH>
                  {editable ? <TH /> : null}
                </TR>
              </THead>
              <TBody>
                {x.units.map((u) => (
                  <TR key={u.id}>
                    <TD>
                      {u.name} {user?.unit.id === u.id ? <Badge variant="info">logged in</Badge> : null}
                    </TD>
                    <TD className="font-mono">{u.code}</TD>
                    <TD className="font-mono">{u.docPrefix || '(none — existing numbers)'}</TD>
                    <TD>{u.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="danger">Inactive</Badge>}</TD>
                    {editable ? (
                      <TD className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setUnitEdit(u)}>
                          Rename
                        </Button>
                        {u.id !== MAIN_ID ? (
                          <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ path: `/units/${u.id}/active`, isActive: !u.isActive })}>
                            {u.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                        ) : null}
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
            {editable ? (
              <div>
                <Button size="sm" variant="outline" onClick={() => setUnitFor(x)}>
                  <Plus /> Add unit
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
      <ExporterDialog editing={exporterDlg} onClose={() => setExporterDlg(null)} />
      {unitFor || unitEdit ? (
        <UnitDialog
          exporter={unitFor}
          unit={unitEdit}
          onClose={() => {
            setUnitFor(null);
            setUnitEdit(null);
          }}
        />
      ) : null}
    </div>
  );
}
