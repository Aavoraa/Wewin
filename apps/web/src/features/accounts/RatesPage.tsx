import { useState } from 'react';
import { Controller, type FieldValues, type UseFormReturn } from 'react-hook-form';
import { zRateContractInput, zRateContractUpdate } from '@wewin/shared';
import { EntityPicker } from '@/components/EntityPicker';
import { Field } from '@/components/DocumentForm';
import { SelectField, TextField } from '@/components/form-fields';
import { MasterCrudPage } from '@/features/masters/MasterCrudPage';
import { pickers } from '../orders/api';
import { type RateContract } from './types';

export const processPicker = (r: never) => {
  const p = r as { id: string; code: string; name: string; stage: string };
  return { id: p.id, label: p.name, sublabel: `${p.code} · ${p.stage}`, data: p };
};

function RateForm({ form, editing }: { form: UseFormReturn<FieldValues, unknown, FieldValues>; editing: RateContract | null }) {
  const [labels, setLabels] = useState<Record<string, string>>(() =>
    editing
      ? {
          [editing.vendorId]: editing.vendor.name,
          [editing.processId]: editing.process.name,
          ...(editing.itemId && editing.item ? { [editing.itemId]: editing.item.name } : {}),
          ...(editing.orderId && editing.order ? { [editing.orderId]: editing.order.orderNo } : {}),
        }
      : {},
  );
  const picker = (name: string, label: string, endpoint: string, map: (r: never) => { id: string; label: string }, query?: Record<string, string>) => (
    <Field label={label} error={form.formState.errors[name]?.message as string | undefined}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <EntityPicker
            endpoint={endpoint}
            query={query}
            map={map}
            value={field.value as string}
            valueLabel={labels[field.value as string]}
            onChange={(o) => {
              if (o) setLabels((x) => ({ ...x, [o.id]: o.label }));
              field.onChange(o?.id ?? (label.endsWith('*') ? '' : null));
            }}
          />
        )}
      />
    </Field>
  );
  return (
    <>
      {picker('vendorId', 'Vendor *', '/vendors', pickers.vendor)}
      {picker('processId', 'Process *', '/processes', processPicker)}
      {picker('itemId', 'Item (optional — narrows the rate)', '/items', pickers.item)}
      {picker('orderId', 'Order (optional — order-specific rate)', '/orders', pickers.order)}
      <SelectField form={form} name="unit" label="Unit" required options={[{ value: 'KG', label: 'per kg' }, { value: 'PCS', label: 'per piece' }]} />
      <TextField form={form} name="rate" label="Rate ₹" required inputMode="decimal" />
      <TextField form={form} name="effectiveFrom" label="Effective from" type="date" required />
      <TextField form={form} name="effectiveTo" label="Effective to (blank = open)" type="date" />
      <TextField form={form} name="remarks" label="Remarks" className="sm:col-span-2" />
    </>
  );
}

/** Rate contracts per vendor + process with an effective period (A§7.3). Used by bill matching. */
export function RatesPage() {
  return (
    <MasterCrudPage<RateContract>
      id="rate-contracts"
      noun="rate contract"
      title="Rate contracts"
      description="Job-work rates per vendor and process. The rate effective on each D.C. date prices the bill match; an order- or item-specific rate wins over a general one."
      endpoint="/rate-contracts"
      editPerm="masters.rates.edit"
      columns={[
        { key: 'vendor.name', header: 'Vendor' },
        { key: 'process.name', header: 'Process' },
        { key: 'item.name', header: 'Item' },
        { key: 'order.orderNo', header: 'Order' },
        { key: 'rate', header: 'Rate ₹', type: 'rate' },
        { key: 'unit', header: 'Per' },
        { key: 'effectiveFrom', header: 'From', type: 'date' },
        { key: 'effectiveTo', header: 'To', type: 'date' },
        { key: 'remarks', header: 'Remarks', hidden: true },
      ]}
      schema={zRateContractInput}
      updateSchema={zRateContractUpdate}
      emptyForm={{ vendorId: '', processId: '', itemId: null, orderId: null, unit: 'KG', rate: '', effectiveFrom: '', effectiveTo: '', remarks: '' }}
      toForm={(r) => ({
        vendorId: r.vendorId,
        processId: r.processId,
        itemId: r.itemId,
        orderId: r.orderId,
        unit: r.unit,
        rate: r.rate,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo ?? '',
        remarks: r.remarks ?? '',
      })}
      renderForm={(form, editing) => <RateForm key={editing?.id ?? 'new'} form={form} editing={editing} />}
    />
  );
}
