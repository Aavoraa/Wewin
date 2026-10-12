import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { type CompanySettingsInput, zCompanySettings } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ErrorState, LoadingState, PageHeader } from '@/components/states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BusinessSettings } from './BusinessSettings';

type Company = CompanySettingsInput & { isPlaceholder: boolean };

const FIELDS: { key: keyof CompanySettingsInput; label: string; span?: boolean }[] = [
  { key: 'legalName', label: 'Legal name', span: true },
  { key: 'tradeName', label: 'Trade name' },
  { key: 'gstin', label: 'GSTIN' },
  { key: 'addressLine1', label: 'Address line 1', span: true },
  { key: 'addressLine2', label: 'Address line 2', span: true },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'stateCode', label: 'State code' },
  { key: 'pincode', label: 'PIN code' },
  { key: 'pan', label: 'PAN' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'iec', label: 'IEC (export)' },
  { key: 'lutNumber', label: 'LUT number' },
  { key: 'lutValidFrom', label: 'LUT valid from' },
  { key: 'lutValidTo', label: 'LUT valid to' },
  { key: 'bankName', label: 'Bank name' },
  { key: 'bankAccount', label: 'Bank account' },
  { key: 'bankIfsc', label: 'IFSC' },
];

export function SettingsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'company'], queryFn: () => api.get<Company>('/settings/company') });
  const form = useForm<CompanySettingsInput>({ resolver: zodResolver(zCompanySettings) });
  const editable = can('settings.edit');

  useEffect(() => {
    if (q.data) {
      const d = { ...q.data } as Record<string, unknown>;
      for (const k of ['lutValidFrom', 'lutValidTo']) if (typeof d[k] === 'string') d[k] = (d[k] as string).slice(0, 10);
      form.reset(d as CompanySettingsInput);
    }
  }, [q.data, form]);

  const save = useMutation({
    mutationFn: (v: CompanySettingsInput) => api.put<Company>('/settings/company', v),
    onSuccess: () => {
      toast.success('Company settings saved');
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <PageHeader title="Company & settings" description="Printed on every document (Rule 55 D.C., bills, invoices)." />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Company {q.data?.isPlaceholder ? <Badge variant="warning">Placeholder — please complete</Badge> : null}
          </CardTitle>
          <CardDescription>GSTIN, address and bank details used in print layouts.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
            <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {FIELDS.map((f) => (
                <div key={f.key} className={f.span ? 'sm:col-span-2' : ''}>
                  <Label htmlFor={f.key}>{f.label}</Label>
                  <Input
                    id={f.key}
                    type={f.key.startsWith('lutValid') ? 'date' : 'text'}
                    aria-invalid={!!form.formState.errors[f.key]}
                    {...form.register(f.key)}
                  />
                  {form.formState.errors[f.key] ? (
                    <span className="text-[11px] text-destructive">{String(form.formState.errors[f.key]?.message)}</span>
                  ) : null}
                </div>
              ))}
            </fieldset>
            {editable ? (
              <div className="mt-4 flex justify-end">
                <Button type="submit" loading={save.isPending}>
                  Save company settings
                </Button>
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>
      <BusinessSettings editable={editable} />
    </div>
  );
}
