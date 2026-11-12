import { useQuery } from '@tanstack/react-query';
import { D, amountInWords } from '@wewin/shared';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { LoadingState } from '@/components/states';
import { type OrderDetail } from '@/features/orders/api';
import { CompanyBlock, PrintLayout, Signatures, useCompany } from './PrintLayout';

interface OrderPrintData extends OrderDetail {
  buyer: OrderDetail['buyer'] & {
    country: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
    paymentTerms: string | null;
  };
}

const money = (v: string) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Buyer order in bill format (A4): letterhead, buyer, order and PO details, one line per colour × size
 * with rate and amount, totals and the amount in words. Drafts print marked DRAFT.
 */
export function OrderPrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useQuery({ queryKey: ['print', 'order', id], queryFn: () => api.get<OrderPrintData>(`/orders/${id}`) });
  if (!q.data || company.isLoading) return <LoadingState />;
  const o = q.data;
  const b = o.buyer;
  const sizeRank = new Map(o.sizes.map((s, i) => [s, i]));
  const colourRank = new Map(o.colours.map((c, i) => [c, i]));
  const lines = o.lines
    .filter((l) => l.qty > 0)
    .sort((x, y) => (colourRank.get(x.colour) ?? 0) - (colourRank.get(y.colour) ?? 0) || (sizeRank.get(x.size) ?? 0) - (sizeRank.get(y.size) ?? 0))
    .map((l) => ({ ...l, amount: l.unitPrice ? D(l.unitPrice).times(l.qty).toFixed(2) : null }));
  const total = lines.reduce((a, l) => (l.amount ? a.plus(D(l.amount)) : a), D(0)).toFixed(2);
  return (
    <PrintLayout title={`Order ${o.orderNo}`}>
      <div className="flex items-start justify-between border-b-2 border-black pb-2">
        <CompanyBlock c={company.data} />
        <div className="text-right">
          <div className="text-base font-bold">ORDER CONFIRMATION</div>
          <div className="font-mono text-sm">{o.orderNo}</div>
          <div>Date: {formatDate(o.confirmedAt ? o.confirmedAt.slice(0, 10) : o.poDate)}</div>
          {o.status === 'DRAFT' ? <div className="font-bold">DRAFT — NOT CONFIRMED</div> : null}
          {o.status === 'CANCELLED' ? <div className="font-bold text-red-700">CANCELLED</div> : null}
          {o.status === 'CLOSED' ? <div className="font-bold">CLOSED</div> : null}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-4 border-b border-black pb-2">
        <div>
          <div className="text-[10px] font-semibold uppercase">Buyer</div>
          <div className="font-semibold">{b.name}</div>
          <div>{[b.addressLine1, b.addressLine2, b.city, b.country].filter(Boolean).join(', ')}</div>
          {b.contactPerson || b.phone || b.email ? <div>{[b.contactPerson, b.phone, b.email].filter(Boolean).join(' · ')}</div> : null}
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3">
          <span>Buyer PO no.</span>
          <b>{o.buyerPoNo}</b>
          <span>PO date</span>
          <b>{formatDate(o.poDate)}</b>
          <span>Ship date</span>
          <b>{o.shipDate ? formatDate(o.shipDate) : '—'}</b>
          <span>Currency</span>
          <b>{o.currency}</b>
          {b.paymentTerms ? (
            <>
              <span>Payment terms</span>
              <b>{b.paymentTerms}</b>
            </>
          ) : null}
        </div>
      </div>

      <div className="mt-2">
        Style: <b>{o.styleNo}</b>
        {o.styleName ? ` — ${o.styleName}` : ''} · {o.garmentItem.name}
        {o.description ? <div>{o.description}</div> : null}
      </div>

      <table className="mt-2 w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="py-1">#</th>
            <th>Description</th>
            <th>Colour</th>
            <th>Size</th>
            <th className="text-right">Qty (pcs)</th>
            <th className="text-right">Rate ({o.currency})</th>
            <th className="text-right">Amount ({o.currency})</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id} className="border-b border-slate-300">
              <td className="py-0.5">{i + 1}</td>
              <td>
                {o.styleNo}
                {o.styleName ? ` ${o.styleName}` : ''}
              </td>
              <td>{l.colour}</td>
              <td>{l.size}</td>
              <td className="text-right">{l.qty.toLocaleString('en-IN')}</td>
              <td className="text-right">{l.unitPrice ?? '—'}</td>
              <td className="text-right">{l.amount ? money(l.amount) : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-black font-bold">
            <td colSpan={4} className="py-1 text-right">
              Total
            </td>
            <td className="text-right">{o.totals.pcs.toLocaleString('en-IN')}</td>
            <td />
            <td className="text-right">
              {o.currency} {money(total)}
            </td>
          </tr>
        </tfoot>
      </table>
      <div className="mt-1 text-[10px]">
        Amount in words: <b>{amountInWords(total, o.currency)}</b>
        {!o.totals.fullyPriced ? <div className="font-semibold">Some lines have no price yet; the total covers priced lines only.</div> : null}
      </div>

      {o.remarks ? <div className="mt-2">Remarks: {o.remarks}</div> : null}
      <Signatures labels={['Prepared by', 'Checked by', `For ${company.data?.tradeName ?? company.data?.legalName ?? ''} — Authorised signatory`]} />
    </PrintLayout>
  );
}
