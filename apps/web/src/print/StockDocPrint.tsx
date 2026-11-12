import { useQuery } from '@tanstack/react-query';
import { D, STOCK_DOC_NAMES, type StockDocKind } from '@wewin/shared';
import { api } from '@/lib/api';
import { formatDate, formatInr, formatQty } from '@/lib/format';
import { LoadingState } from '@/components/states';
import { ChallanCopies, CompanyBlock, PrintLayout, Signatures, VendorCertificate, useCompany } from './PrintLayout';

interface StockDocPrintData {
  id: string;
  docNo: string | null;
  docDate: string;
  kind: StockDocKind;
  status: string;
  purpose: string | null;
  partyName: string | null;
  fromProcess: string | null;
  deliveredBy: string | null;
  vehicleNo: string | null;
  remarks: string | null;
  vendor: {
    name: string;
    gstin: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    stateCode: string | null;
    pincode: string | null;
    certificateNo: string | null;
    certificateExpiry: string | null;
  } | null;
  order: { orderNo: string; styleNo: string } | null;
  lines: {
    id: string;
    colour: string;
    size: string;
    lot: string;
    millName: string | null;
    counts: string | null;
    bags: number | null;
    qty: string;
    unit: string;
    rate: string | null;
    reason: string | null;
    item: { name: string; hsnCode: string | null };
  }[];
  totals: { bags: number; qty: string; value: string };
}

/**
 * Yarn / fabric delivery to others and rejection entries, printed as a three-copy delivery challan
 * (original / duplicate / triplicate, A4) like the outward D.C. (Q-077).
 */
export function StockDocPrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useQuery({ queryKey: ['print', 'stock-doc', id], queryFn: () => api.get<StockDocPrintData>(`/stock-docs/${id}`) });
  if (!q.data || company.isLoading) return <LoadingState />;
  const d = q.data;
  const v = d.vendor;
  const rejection = d.kind === 'REJECTION';
  const signatory = `For ${company.data?.tradeName ?? company.data?.legalName ?? ''} — Authorised signatory`;
  return (
    <PrintLayout title={`${STOCK_DOC_NAMES[d.kind]} ${d.docNo ?? ''}`}>
      <ChallanCopies>
        {() => (
          <>
            <div className="flex items-start justify-between border-b-2 border-black pb-2">
              <CompanyBlock c={company.data} />
              <div className="text-right">
                <div className="text-base font-bold">DELIVERY CHALLAN</div>
                <div className="text-[10px]">{STOCK_DOC_NAMES[d.kind]}</div>
                <div className="mt-1 font-mono text-sm">{d.docNo ?? 'DRAFT'}</div>
                <div>Date: {formatDate(d.docDate)}</div>
                {d.status === 'CANCELLED' ? <div className="font-bold text-red-700">CANCELLED</div> : null}
              </div>
            </div>
            <div className="my-2 grid grid-cols-2 gap-3 border-b border-black pb-2">
              <div>
                <div className="font-semibold">Consignee</div>
                {v ? (
                  <>
                    <div className="font-semibold">{v.name}</div>
                    <div>{[v.addressLine1, v.addressLine2, v.city, v.pincode].filter(Boolean).join(', ')}</div>
                    <div>
                      State: {v.state ?? '—'} {v.stateCode ? `(${v.stateCode})` : ''}
                    </div>
                    <div className="font-semibold">GSTIN: {v.gstin ?? 'Unregistered'}</div>
                    <VendorCertificate v={v} />
                  </>
                ) : (
                  <div className="font-semibold">{d.partyName ?? '—'}</div>
                )}
              </div>
              <div>
                {d.purpose ? <div>Purpose: {d.purpose}</div> : null}
                {d.order ? (
                  <div>
                    Order: {d.order.orderNo} · {d.order.styleNo}
                  </div>
                ) : null}
                {d.fromProcess ? <div>From process: {d.fromProcess}</div> : null}
                {d.deliveredBy ? <div>Delivered by: {d.deliveredBy}</div> : null}
                <div>Vehicle no.: {d.vehicleNo ?? '—'}</div>
              </div>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-y border-black">
                  <th className="py-1 text-left">#</th>
                  <th className="text-left">Description of goods</th>
                  <th className="text-left">HSN</th>
                  <th className="text-left">Lot</th>
                  {rejection ? <th className="text-left">Reason</th> : null}
                  <th className="text-right">Bags</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Rate ₹</th>
                  <th className="text-right">Value ₹</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l, i) => (
                  <tr key={l.id} className="border-b border-slate-300 align-top">
                    <td className="py-0.5">{i + 1}</td>
                    <td>
                      {l.item.name}
                      {[l.counts, l.millName, l.colour, l.size]
                        .filter(Boolean)
                        .map((x) => ` · ${x}`)
                        .join('')}
                    </td>
                    <td>{l.item.hsnCode ?? ''}</td>
                    <td>{l.lot}</td>
                    {rejection ? <td>{l.reason ?? ''}</td> : null}
                    <td className="text-right">{l.bags ?? ''}</td>
                    <td className="text-right">
                      {formatQty(l.qty)} {l.unit.toLowerCase()}
                    </td>
                    <td className="text-right">{l.rate ?? ''}</td>
                    <td className="text-right">{l.rate ? formatInr(D(l.qty).times(D(l.rate)).toFixed(2), { symbol: false }) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-b border-black font-bold">
                  <td colSpan={rejection ? 5 : 4} className="py-1">
                    Total
                  </td>
                  <td className="text-right">{d.totals.bags || ''}</td>
                  <td className="text-right">{formatQty(d.totals.qty)}</td>
                  <td />
                  <td className="text-right">{formatInr(d.totals.value)}</td>
                </tr>
              </tfoot>
            </table>
            <p className="mt-2 text-[10px]">Value stated for the purpose of the delivery challan only.</p>
            {d.remarks ? <div className="mt-1">Remarks: {d.remarks}</div> : null}
            <Signatures labels={['Prepared by', 'Receiver signature & seal', signatory]} />
          </>
        )}
      </ChallanCopies>
    </PrintLayout>
  );
}
