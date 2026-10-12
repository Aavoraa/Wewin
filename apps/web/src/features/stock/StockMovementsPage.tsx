import { useState } from 'react';
import { DataTable, type DTColumn } from '@/components/DataTable';
import { PageHeader } from '@/components/states';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useFy } from '@/lib/fy';

interface MovementRow {
  id: string;
  docDate: string;
  postedAt: string;
  sourceType: string;
  isReversal: boolean;
  itemCode: string;
  itemName: string;
  lot: string;
  colour: string;
  size: string;
  qty: string;
  unit: string;
  from: { code: string; name: string };
  to: { code: string; name: string };
}

const columns: DTColumn<MovementRow>[] = [
  { key: 'docDate', header: 'Date', type: 'date' },
  { key: 'sourceType', header: 'Document', cell: (r) => (
    <span className="flex items-center gap-1">
      {r.sourceType.replace(/_/g, ' ')} {r.isReversal ? <Badge variant="cancelled">reversal</Badge> : null}
    </span>
  ) },
  { key: 'itemCode', header: 'Item code' },
  { key: 'itemName', header: 'Item', hidden: true },
  { key: 'lot', header: 'Lot' },
  { key: 'colour', header: 'Colour', hidden: true },
  { key: 'size', header: 'Size', hidden: true },
  { key: 'from.name', header: 'From' },
  { key: 'to.name', header: 'To' },
  { key: 'qty', header: 'Qty', type: 'kg' },
  { key: 'unit', header: 'Unit' },
  { key: 'postedAt', header: 'Posted at', type: 'datetime', hidden: true },
];

/** Full stock movement history (the ledger itself). Filtered by the selected financial year. */
export function StockMovementsPage() {
  const fy = useFy();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  return (
    <div>
      <PageHeader title="Stock movements" description={`Every posted movement, append-only. FY ${fy.fyCode}.`} />
      <DataTable<MovementRow>
        id="stock-movements"
        endpoint="/stock/movements"
        columns={columns}
        exportTitle="Stock movements"
        filters={{ from: from || fy.start, to: to || fy.end }}
        filterBar={
          <>
            <Input type="date" className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <Input type="date" className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </>
        }
      />
    </div>
  );
}
