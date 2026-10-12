import { useState } from 'react';
import { ITEM_TYPES, UNITS, zBuyerInput, zBuyerUpdate, zItemInput, zItemUpdate, zProcessInput } from '@wewin/shared';
import { z } from 'zod';
import { type DTColumn } from '@/components/DataTable';
import { SelectField, TextField } from '@/components/form-fields';
import { Select } from '@/components/ui/input';
import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/states';
import { MasterCrudPage, type MasterRow } from './MasterCrudPage';

// ───────── Buyers ─────────
interface BuyerRow extends MasterRow {
  code: string;
  name: string;
  country: string | null;
  city: string | null;
  currency: string;
  email: string | null;
  [k: string]: unknown;
}
const BUYER_FIELDS = ['code', 'name', 'country', 'addressLine1', 'addressLine2', 'city', 'contactPerson', 'phone', 'email', 'currency', 'paymentTerms'] as const;

export function BuyersPage() {
  return (
    <MasterCrudPage<BuyerRow>
      id="buyers"
      noun="buyer"
      title="Buyers"
      description="Export customers."
      endpoint="/buyers"
      columns={[
        { key: 'code', header: 'Code', sort: 'code' },
        { key: 'name', header: 'Name', sort: 'name' },
        { key: 'country', header: 'Country', sort: 'country' },
        { key: 'city', header: 'City' },
        { key: 'currency', header: 'Currency' },
        { key: 'email', header: 'Email', hidden: true },
      ]}
      schema={zBuyerInput}
      updateSchema={zBuyerUpdate}
      emptyForm={{ ...Object.fromEntries(BUYER_FIELDS.map((f) => [f, ''])), currency: 'USD' }}
      toForm={(r) => Object.fromEntries(BUYER_FIELDS.map((f) => [f, r[f] ?? '']))}
      renderForm={(form, editing) => (
        <>
          <TextField form={form} name="code" label="Code" required hint={editing ? 'Code cannot change' : undefined} />
          <TextField form={form} name="name" label="Name" required />
          <TextField form={form} name="country" label="Country" />
          <TextField form={form} name="currency" label="Currency (ISO)" required />
          <TextField form={form} name="addressLine1" label="Address line 1" className="sm:col-span-2" />
          <TextField form={form} name="addressLine2" label="Address line 2" className="sm:col-span-2" />
          <TextField form={form} name="city" label="City" />
          <TextField form={form} name="contactPerson" label="Contact person" />
          <TextField form={form} name="phone" label="Phone" />
          <TextField form={form} name="email" label="Email" type="email" />
          <TextField form={form} name="paymentTerms" label="Payment terms" className="sm:col-span-2" />
        </>
      )}
    />
  );
}

// ───────── Items ─────────
interface ItemRow extends MasterRow {
  code: string;
  name: string;
  type: string;
  unit: string;
  hsnCode: string | null;
  spec: string | null;
  gsm: number | null;
  [k: string]: unknown;
}
const ITEM_FIELDS = ['code', 'name', 'type', 'unit', 'hsnCode', 'spec', 'gsm'] as const;

export function ItemsPage() {
  const [type, setType] = useState('');
  return (
    <MasterCrudPage<ItemRow>
      id="items"
      noun="item"
      title="Items"
      description="Yarn, fabric, panels, garments and trims. Code, type and unit lock once stock has moved."
      endpoint="/items"
      columns={[
        { key: 'code', header: 'Code', sort: 'code' },
        { key: 'name', header: 'Name', sort: 'name' },
        { key: 'type', header: 'Type', sort: 'type' },
        { key: 'unit', header: 'Unit' },
        { key: 'hsnCode', header: 'HSN' },
        { key: 'gsm', header: 'GSM', type: 'int' },
        { key: 'spec', header: 'Specification', hidden: true },
      ]}
      filters={{ type: type || undefined }}
      filterBar={
        <Select className="h-9 w-32" value={type} onChange={(e) => setType(e.target.value)} aria-label="Item type">
          <option value="">All types</option>
          {ITEM_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
      }
      schema={zItemInput}
      updateSchema={zItemUpdate}
      emptyForm={{ code: '', name: '', type: 'YARN', unit: 'KG', hsnCode: '', spec: '', gsm: '' }}
      toForm={(r) => Object.fromEntries(ITEM_FIELDS.map((f) => [f, r[f] ?? '']))}
      renderForm={(form) => (
        <>
          <TextField form={form} name="code" label="Code" required />
          <TextField form={form} name="name" label="Name" required />
          <SelectField form={form} name="type" label="Type" options={ITEM_TYPES.map((t) => ({ value: t, label: t }))} />
          <SelectField form={form} name="unit" label="Stock unit" options={UNITS.map((t) => ({ value: t, label: t }))} />
          <TextField form={form} name="hsnCode" label="HSN code" />
          <TextField form={form} name="gsm" label="GSM (fabric)" type="number" />
          <TextField form={form} name="spec" label="Specification (count, composition, construction)" className="sm:col-span-2" />
        </>
      )}
    />
  );
}

// ───────── Processes ─────────
interface ProcessRow extends MasterRow {
  code: string;
  name: string;
  stage: string;
  defaultReturnDays: number;
}

export function ProcessesPage() {
  return (
    <MasterCrudPage<ProcessRow>
      id="processes"
      noun="process"
      title="Processes"
      description="Job-work processes. Kilo-stage processes carry allowed loss %; default return days drive overdue alerts."
      endpoint="/processes"
      columns={[
        { key: 'code', header: 'Code', sort: 'code' },
        { key: 'name', header: 'Name', sort: 'name' },
        { key: 'stage', header: 'Stage' },
        { key: 'defaultReturnDays', header: 'Default return days', type: 'int' },
      ]}
      schema={zProcessInput}
      updateSchema={zProcessInput.extend({ version: z.number().int() })}
      emptyForm={{ code: '', name: '', stage: 'KG', defaultReturnDays: 15 }}
      toForm={(r) => ({ code: r.code, name: r.name, stage: r.stage, defaultReturnDays: r.defaultReturnDays })}
      dialogClassName="max-w-lg"
      renderForm={(form) => (
        <>
          <TextField form={form} name="code" label="Code" required />
          <TextField form={form} name="name" label="Name" required />
          <SelectField form={form} name="stage" label="Stage" options={[{ value: 'KG', label: 'Kilo stage (yarn/fabric)' }, { value: 'PCS', label: 'Piece stage (panels)' }]} />
          <TextField form={form} name="defaultReturnDays" label="Default return days" type="number" />
        </>
      )}
    />
  );
}

// ───────── Locations (read-only) ─────────
interface LocationRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  isActive: boolean;
}

export function LocationsPage() {
  const [kind, setKind] = useState('');
  const columns: DTColumn<LocationRow>[] = [
    { key: 'code', header: 'Code', sort: 'code' },
    { key: 'name', header: 'Name', sort: 'name' },
    { key: 'kind', header: 'Kind', sort: 'kind' },
  ];
  return (
    <div>
      <PageHeader title="Locations" description="Own stores, one location per vendor (automatic) and virtual locations that balance the ledger." />
      <DataTable<LocationRow>
        id="locations"
        endpoint="/locations"
        columns={columns}
        exportTitle="Locations"
        filters={{ kind: kind || undefined, active: 'all' }}
        filterBar={
          <Select className="h-9 w-32" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
            <option value="">All kinds</option>
            <option value="OWN">Own</option>
            <option value="VENDOR">Vendor</option>
            <option value="VIRTUAL">Virtual</option>
          </Select>
        }
      />
    </div>
  );
}
