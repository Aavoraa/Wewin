import { useQuery } from '@tanstack/react-query';
import { Controller } from 'react-hook-form';
import { zVendorInput, zVendorUpdate } from '@wewin/shared';
import { api } from '@/lib/api';
import { type DTColumn } from '@/components/DataTable';
import { CheckboxField, TextField } from '@/components/form-fields';
import { Checkbox, Label } from '@/components/ui/input';
import { MasterCrudPage, type MasterRow } from './MasterCrudPage';

export interface VendorRow extends MasterRow {
  code: string;
  name: string;
  gstin: string | null;
  city: string | null;
  phone: string | null;
  creditDays: number;
  tdsApplicable: boolean;
  tdsRatePct: string | null;
  debitNoteGstApplicable: boolean;
  debitNoteGstRatePct: string | null;
  processes: { id: string; code: string; name: string }[];
  processIds: string[];
  [k: string]: unknown;
}

interface ProcessRow {
  id: string;
  code: string;
  name: string;
}

const columns: DTColumn<VendorRow>[] = [
  { key: 'code', header: 'Code', sort: 'code' },
  { key: 'name', header: 'Name', sort: 'name' },
  { key: 'processes', header: 'Processes', cell: (r) => r.processes.map((p) => p.name).join(', ') || '—' },
  { key: 'gstin', header: 'GSTIN' },
  { key: 'city', header: 'City', sort: 'city' },
  { key: 'phone', header: 'Phone', hidden: true },
  { key: 'creditDays', header: 'Credit days', type: 'int', sort: 'creditDays' },
];

const FIELDS = [
  'code', 'name', 'gstin', 'pan', 'addressLine1', 'addressLine2', 'city', 'state', 'stateCode', 'pincode', 'contactPerson',
  'phone', 'email', 'whatsappNumber', 'creditDays', 'tdsApplicable', 'tdsRatePct', 'debitNoteGstApplicable',
  'debitNoteGstRatePct', 'bankName', 'bankAccount', 'bankIfsc', 'processIds',
] as const;

const empty = Object.fromEntries(FIELDS.map((f) => [f, ''])) as Record<string, unknown>;
Object.assign(empty, { creditDays: 0, tdsApplicable: false, debitNoteGstApplicable: false, processIds: [], state: 'Tamil Nadu', stateCode: '33' });

/** Vendors: mills, job workers and suppliers. Each vendor automatically gets a stock location. */
export function VendorsPage() {
  const processes = useQuery({
    queryKey: ['picker', 'processes-all'],
    queryFn: () => api.list<ProcessRow>('/processes', { pageSize: 100, active: 'true' }),
  });
  return (
    <MasterCrudPage<VendorRow>
      id="vendors"
      noun="vendor"
      title="Vendors"
      description="Knitters, dyers, compactors, printers, embroiderers, mills and suppliers. Creating a vendor creates its stock location."
      endpoint="/vendors"
      columns={columns}
      schema={zVendorInput}
      updateSchema={zVendorUpdate}
      emptyForm={empty}
      toForm={(r) => Object.fromEntries(FIELDS.map((f) => [f, r[f] ?? (f === 'processIds' ? [] : '')]))}
      dialogClassName="max-w-3xl"
      renderForm={(form, editing) => (
        <>
          <TextField form={form} name="code" label="Code" required hint={editing ? 'Code cannot change' : undefined} />
          <TextField form={form} name="name" label="Name" required />
          <TextField form={form} name="gstin" label="GSTIN" />
          <TextField form={form} name="pan" label="PAN" />
          <TextField form={form} name="addressLine1" label="Address line 1" className="sm:col-span-2" />
          <TextField form={form} name="addressLine2" label="Address line 2" className="sm:col-span-2" />
          <TextField form={form} name="city" label="City" />
          <TextField form={form} name="state" label="State" />
          <TextField form={form} name="stateCode" label="State code" />
          <TextField form={form} name="pincode" label="PIN code" />
          <TextField form={form} name="contactPerson" label="Contact person" />
          <TextField form={form} name="phone" label="Phone" />
          <TextField form={form} name="email" label="Email" type="email" />
          <TextField form={form} name="whatsappNumber" label="WhatsApp number" />
          <TextField form={form} name="creditDays" label="Credit days" type="number" />
          <div className="sm:col-span-2">
            <Label>Processes</Label>
            <Controller
              control={form.control}
              name="processIds"
              render={({ field }) => (
                <div className="mt-1 flex flex-wrap gap-3">
                  {(processes.data?.data ?? []).map((p) => {
                    const selected = (field.value as string[]).includes(p.id);
                    return (
                      <label key={p.id} className="flex items-center gap-1.5 text-sm">
                        <Checkbox
                          checked={selected}
                          onChange={(e) =>
                            field.onChange(e.target.checked ? [...(field.value as string[]), p.id] : (field.value as string[]).filter((x) => x !== p.id))
                          }
                        />
                        {p.name}
                      </label>
                    );
                  })}
                </div>
              )}
            />
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3 sm:col-span-2">
            <div className="mb-2 text-xs text-amber-800">
              Tax treatment is configured per vendor and must be confirmed with Wewin&apos;s auditor (Q-008). Nothing is applied unless ticked.
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <CheckboxField form={form} name="tdsApplicable" label="TDS u/s 194C applies" />
              <TextField form={form} name="tdsRatePct" label="TDS rate %" inputMode="decimal" />
              <CheckboxField form={form} name="debitNoteGstApplicable" label="Debit notes carry GST" />
              <TextField form={form} name="debitNoteGstRatePct" label="Debit note GST %" inputMode="decimal" />
            </div>
          </div>
          <TextField form={form} name="bankName" label="Bank" />
          <TextField form={form} name="bankAccount" label="Account no." />
          <TextField form={form} name="bankIfsc" label="IFSC" />
        </>
      )}
    />
  );
}
