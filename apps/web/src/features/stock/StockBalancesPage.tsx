import { useState } from 'react';
import { ITEM_TYPES } from '@wewin/shared';
import { DataTable, type DTColumn } from '@/components/DataTable';
import { PageHeader } from '@/components/states';
import { Checkbox, Select } from '@/components/ui/input';

export interface BalanceRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: string;
  locationCode: string;
  locationName: string;
  locationKind: string;
  lot: string;
  colour: string;
  size: string;
  orderNo: string | null;
  unit: string;
  qty: string;
}

export const balanceColumns: DTColumn<BalanceRow>[] = [
  { key: 'locationName', header: 'Location' },
  { key: 'locationKind', header: 'Kind', hidden: true },
  { key: 'itemCode', header: 'Item code' },
  { key: 'itemName', header: 'Item' },
  { key: 'itemType', header: 'Type' },
  { key: 'lot', header: 'Lot / dye lot' },
  { key: 'colour', header: 'Colour' },
  { key: 'size', header: 'Size' },
  { key: 'orderNo', header: 'Order', hidden: true },
  { key: 'unit', header: 'Unit' },
  { key: 'qty', header: 'Balance', type: 'kg' },
];

/** Stock balances by item, lot and location — derived from the single stock ledger (A§6). */
export function StockBalancesPage() {
  const [kind, setKind] = useState('');
  const [type, setType] = useState('');
  const [live, setLive] = useState(false);
  return (
    <div>
      <PageHeader
        title="Stock balances"
        description="Sum of stock movements per item, lot and location. Virtual locations are hidden unless selected."
      />
      <DataTable<BalanceRow>
        id="stock-balances"
        endpoint="/stock/balances"
        columns={balanceColumns}
        exportTitle="Stock balances"
        searchPlaceholder="Item code, name or location…"
        filters={{ locationKind: kind || undefined, itemType: type || undefined, live: live ? 'true' : undefined }}
        emptyHint="Stock appears here once receipts and other documents are posted."
        filterBar={
          <>
            <Select className="h-9 w-36" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Location kind">
              <option value="">Own + vendors</option>
              <option value="OWN">Own stores</option>
              <option value="VENDOR">At vendors</option>
              <option value="VIRTUAL">Virtual</option>
            </Select>
            <Select className="h-9 w-32" value={type} onChange={(e) => setType(e.target.value)} aria-label="Item type">
              <option value="">All types</option>
              {ITEM_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Read directly from the ledger instead of the cached view">
              <Checkbox checked={live} onChange={(e) => setLive(e.target.checked)} /> Live
            </label>
          </>
        }
      />
    </div>
  );
}
