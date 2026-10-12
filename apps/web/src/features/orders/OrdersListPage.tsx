import { useState } from 'react';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useFy } from '@/lib/fy';
import { DataTable, type DTColumn } from '@/components/DataTable';
import { PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';

interface OrderRow {
  id: string;
  orderNo: string;
  buyerPoNo: string;
  styleNo: string;
  poDate: string;
  shipDate: string | null;
  status: string;
  totalPcs: number;
  currency: string;
  buyer: { code: string; name: string };
}

const columns: DTColumn<OrderRow>[] = [
  { key: 'orderNo', header: 'Order no.', sort: 'orderNo', cell: (r) => <span className="font-mono">{r.orderNo}</span> },
  { key: 'buyer.name', header: 'Buyer' },
  { key: 'buyerPoNo', header: 'Buyer PO' },
  { key: 'styleNo', header: 'Style' },
  { key: 'poDate', header: 'PO date', type: 'date', sort: 'poDate' },
  { key: 'shipDate', header: 'Ship date', type: 'date', sort: 'shipDate' },
  { key: 'totalPcs', header: 'Qty (pcs)', type: 'qty' },
  { key: 'status', header: 'Status', type: 'status', sort: 'status' },
];

export function OrdersListPage() {
  const { can } = useAuth();
  const fy = useFy();
  const [status, setStatus] = useState('');
  return (
    <div>
      <PageHeader
        title="Orders"
        description={`Buyer orders with colour × size quantities — PO date in FY ${fy.fyCode}.`}
        actions={
          can('orders.create') ? (
            <Button asChild>
              <Link to="/orders/new">
                <Plus /> New order
              </Link>
            </Button>
          ) : null
        }
      />
      <DataTable<OrderRow>
        id="orders"
        endpoint="/orders"
        columns={columns}
        exportTitle="Orders"
        searchPlaceholder="Order, PO, style or buyer…"
        rowHref={(r) => `/orders/${r.id}`}
        filters={{ status: status || undefined, from: fy.start, to: fy.end }}
        filterBar={
          <Select className="h-9 w-36" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {['DRAFT', 'CONFIRMED', 'CLOSED', 'CANCELLED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        }
      />
    </div>
  );
}
