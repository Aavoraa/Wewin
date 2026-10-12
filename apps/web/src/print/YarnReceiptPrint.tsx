import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDate, formatInr, formatKg } from '@/lib/format';
import { LoadingState } from '@/components/states';
import { type YarnReceipt } from '@/features/yarn/YarnPages';
import { CompanyBlock, PrintLayout, Signatures, useCompany } from './PrintLayout';

/** Goods receipt note for yarn (A5). */
export function YarnReceiptPrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useQuery({ queryKey: ['print', 'yarn', id], queryFn: () => api.get<YarnReceipt>(`/yarn-receipts/${id}/print`) });
  if (!q.data || company.isLoading) return <LoadingState />;
  const r = q.data;
  return (
    <PrintLayout size="A5" title={`GRN ${r.docNo ?? ''}`}>
      <div className="flex items-start justify-between border-b border-black pb-2">
        <CompanyBlock c={company.data} />
        <div className="text-right">
          <div className="text-sm font-bold">GOODS RECEIPT NOTE — YARN</div>
          <div className="font-mono">{r.docNo ?? 'DRAFT'}</div>
          <div>Date: {formatDate(r.docDate)}</div>
          {r.status === 'CANCELLED' ? <div className="font-bold text-red-700">CANCELLED</div> : null}
        </div>
      </div>
      <div className="my-2 grid grid-cols-2 gap-2">
        <div>
          <div className="font-semibold">Received from</div>
          <div>{r.vendor.name}</div>
          {r.vendor.gstin ? <div>GSTIN: {r.vendor.gstin}</div> : null}
        </div>
        <div>
          <div>Invoice: {r.supplierInvoiceNo ?? '—'} {r.supplierInvoiceDate ? `dt ${formatDate(r.supplierInvoiceDate)}` : ''}</div>
          <div>Vehicle: {r.vehicleNo ?? '—'}</div>
          <div>Order: {r.order?.orderNo ?? '—'}</div>
        </div>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-black">
            <th className="py-1 text-left">#</th>
            <th className="text-left">Yarn</th>
            <th className="text-left">HSN</th>
            <th className="text-left">Lot</th>
            <th className="text-right">Bags</th>
            <th className="text-right">Kg</th>
            <th className="text-right">Rate</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.id} className="border-b border-slate-300">
              <td className="py-0.5">{l.lineNo}</td>
              <td>{l.item.name}</td>
              <td>{l.item.hsnCode ?? ''}</td>
              <td>{l.lot}</td>
              <td className="text-right">{l.bags ?? ''}</td>
              <td className="text-right">{formatKg(l.qtyKg)}</td>
              <td className="text-right">{l.ratePerKg ?? ''}</td>
              <td className="text-right">{l.amount ? formatInr(l.amount, { symbol: false }) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-b border-black font-bold">
            <td colSpan={4} className="py-1">
              Total
            </td>
            <td className="text-right">{r.totals.bags}</td>
            <td className="text-right">{formatKg(r.totals.kg)}</td>
            <td />
            <td className="text-right">{formatInr(r.totals.value)}</td>
          </tr>
        </tfoot>
      </table>
      {r.remarks ? <div className="mt-2">Remarks: {r.remarks}</div> : null}
      <Signatures labels={['Received by (Stores)', 'Checked by', 'Authorised signatory']} />
    </PrintLayout>
  );
}
