import { useQuery } from '@tanstack/react-query';
import { rupeesInWords } from '@wewin/shared';
import { api } from '@/lib/api';
import { formatDate, formatInr } from '@/lib/format';
import { LoadingState } from '@/components/states';
import { type PoDoc } from '@/features/purchase/PurchasePages';
import { CompanyBlock, PrintLayout, Signatures, useCompany } from './PrintLayout';

const TITLE: Record<PoDoc['kind'], string> = { YARN: 'PURCHASE ORDER — YARN', FABRIC: 'PURCHASE ORDER — FABRIC', ACCESSORY: 'PURCHASE ORDER — ACCESSORIES' };
const qty = (v: string) => String(Number(v));

/** Purchase order (A4), laid out like the desktop software's PO print. */
export function PurchaseOrderPrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useQuery({ queryKey: ['print', 'po', id], queryFn: () => api.get<PoDoc>(`/purchase-orders/${id}`) });
  if (!q.data || company.isLoading) return <LoadingState />;
  const p = q.data;
  const t = p.totals;
  const orders = p.order ? [p.order.orderNo + (p.order.styleNo ? `/${p.order.styleNo}` : '')] : [...new Set(p.lines.map((l) => l.order && `${l.order.orderNo}/${l.order.styleNo}`).filter(Boolean))];
  const v = p.vendor;
  const half = Number(p.taxPct) / 2;
  const spec = (l: PoDoc['lines'][number]) =>
    [
      l.description,
      p.kind === 'FABRIC' && [l.counts, l.gsm ? `${l.gsm} GSM` : null, l.gauge ? `GG ${l.gauge}` : null, l.loopLength ? `LL ${l.loopLength}` : null, l.dia ? `Dia ${l.dia}` : null, l.design].filter(Boolean).join(' · '),
      l.remarks,
    ]
      .filter(Boolean)
      .join(' — ');
  return (
    <PrintLayout size="A4" title={`PO ${p.docNo ?? ''}`}>
      <div className="border border-black">
        <div className="flex justify-between border-b border-black px-2 py-1">
          <span className="font-bold underline">{TITLE[p.kind]}</span>
          <span>
            {p.status === 'DRAFT' ? <b>DRAFT — NOT APPROVED</b> : null}
            {p.status === 'CANCELLED' ? <b className="text-red-700">CANCELLED</b> : null}
            {p.status === 'CLOSED' ? <b>CLOSED</b> : null}
          </span>
        </div>
        <div className="grid grid-cols-2 border-b border-black">
          <div className="border-r border-black p-2">
            <CompanyBlock c={company.data} />
          </div>
          <div className="p-2">
            <div className="text-[10px]">To</div>
            <div className="text-sm font-bold">M/s. {v.name}</div>
            <div className="text-[10px] leading-tight">{[v.addressLine1, v.addressLine2, v.city, v.pincode].filter(Boolean).join(', ')}</div>
            <div className="mt-1 text-[10px]">
              Cont: {v.contactPerson ?? ''} {v.phone ? `· Phone: ${v.phone}` : ''}
            </div>
            <div className="text-[10px] font-semibold">GSTIN: {v.gstin ?? ''}</div>
            <div className="text-[10px]">State name / code: {[v.state, v.stateCode].filter(Boolean).join(' / ')}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 border-b border-black">
          <div className="border-r border-black p-2">
            <div>
              PO No: <b className="font-mono text-sm">{p.docNo ?? 'DRAFT'}</b>
            </div>
            <div>
              Date: <b>{formatDate(p.docDate)}</b>
            </div>
            {p.order ? <div>Buyer: {p.order.buyer.name}</div> : null}
            {p.reqNo ? <div>Req. no: {p.reqNo}</div> : null}
          </div>
          <div className="p-2">
            <div>Ord. ref: <b>{p.purpose === 'GENERAL' ? 'General stock' : orders.join(', ')}</b></div>
            {p.accessoryType ? <div>Accessories type: {p.accessoryType}</div> : null}
            {p.currency !== 'INR' ? <div>Currency: {p.currency}</div> : null}
          </div>
        </div>
        <div className="border-b border-black px-2 py-1 text-center">We would like to place an order for the following items as per our terms and conditions.</div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-black">
              <th className="w-8 border-r border-black py-1">Sl</th>
              <th className="border-r border-black text-left">{p.kind === 'YARN' ? 'Yarn description' : p.kind === 'FABRIC' ? 'Fabric description' : 'Item description'}</th>
              {p.kind === 'YARN' ? <th className="border-r border-black text-left">Mill name</th> : null}
              {p.kind === 'YARN' ? <th className="border-r border-black text-right">Bag</th> : null}
              {p.kind !== 'YARN' ? <th className="border-r border-black text-left">Colour</th> : null}
              {p.kind === 'ACCESSORY' ? <th className="border-r border-black text-left">Size</th> : null}
              <th className="border-r border-black">Uom</th>
              <th className="border-r border-black text-right">Qty</th>
              <th className="border-r border-black text-right">Rate</th>
              <th className="border-r border-black text-right">Per</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="border-r border-black py-1 text-center">{l.lineNo}</td>
                <td className="border-r border-black px-1">
                  <div className="font-semibold">{l.item.name}</div>
                  {spec(l) ? <div className="text-[10px]">{spec(l)}</div> : null}
                </td>
                {p.kind === 'YARN' ? <td className="border-r border-black px-1">{l.millName ?? ''}</td> : null}
                {p.kind === 'YARN' ? <td className="border-r border-black px-1 text-right">{l.bags ?? ''}</td> : null}
                {p.kind !== 'YARN' ? <td className="border-r border-black px-1">{l.colour ?? ''}</td> : null}
                {p.kind === 'ACCESSORY' ? <td className="border-r border-black px-1">{l.size ?? ''}</td> : null}
                <td className="border-r border-black px-1 text-center">{l.unit}</td>
                <td className="border-r border-black px-1 text-right">
                  {qty(l.qty)}
                  {l.altQty ? <div className="text-[10px]">{qty(l.altQty)} mtr/pcs</div> : null}
                </td>
                <td className="border-r border-black px-1 text-right">{Number(l.rate).toFixed(2)}</td>
                <td className="border-r border-black px-1 text-right">{Number(l.per) === 1 ? '' : qty(l.per)}</td>
                <td className="px-1 text-right">{formatInr(l.amount, { symbol: false })}</td>
              </tr>
            ))}
            <tr className="h-16">
              <td colSpan={20} />
            </tr>
          </tbody>
        </table>
        <div className="grid grid-cols-[1fr_auto] border-t border-black">
          <div className="p-2 font-semibold">Total qty: {qty(p.totalQty)}</div>
          <table className="m-1 text-right">
            <tbody>
              <TotalRow label="Gross total" value={t.gross} />
              {Number(p.packingForwarding) ? <TotalRow label="Packing & forwarding" value={p.packingForwarding} /> : null}
              {Number(t.duty) ? <TotalRow label={`Duty @ ${Number(p.dutyPct)}%`} value={t.duty} /> : null}
              {p.interState ? (
                <TotalRow label={`IGST @ ${Number(p.taxPct)}%`} value={t.igst} />
              ) : (
                <>
                  <TotalRow label={`CGST @ ${half}%`} value={t.cgst} />
                  <TotalRow label={`SGST @ ${half}%`} value={t.sgst} />
                </>
              )}
              {Number(t.tcs) ? <TotalRow label={`TCS @ ${Number(p.tcsPct)}%`} value={t.tcs} /> : null}
              {Number(t.roundOff) ? <TotalRow label="Rounding" value={t.roundOff} /> : null}
              <tr className="border-t border-black font-bold">
                <td className="pr-4">Net amount</td>
                <td>{formatInr(t.net, { symbol: false })}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="border-t border-black px-2 py-1">
          Rupees: <b>{rupeesInWords(t.net)}</b>
        </div>
        <div className="grid gap-1 border-t border-black p-2">
          <div>Delivery at: {p.deliveryAt ?? ''}</div>
          <div>Payment terms: {p.paymentTerms ?? ''}</div>
          <div>Delivery date: {p.deliveryDate ? formatDate(p.deliveryDate) : ''}</div>
          {p.freightPaidBy ? <div>Freight paid by: {p.freightPaidBy}</div> : null}
          {p.taxInclusive ? <div>Rates are inclusive of tax.</div> : null}
          {p.remarks ? <div>Remarks: {p.remarks}</div> : null}
        </div>
      </div>
      <Signatures labels={['Prepared by', 'Checked by', `For ${company.data?.tradeName ?? company.data?.legalName ?? ''}`]} />
    </PrintLayout>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="pr-4">{label}</td>
      <td>{formatInr(value, { symbol: false })}</td>
    </tr>
  );
}
