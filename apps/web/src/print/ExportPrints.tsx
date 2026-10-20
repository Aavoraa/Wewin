import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDate, formatInr, formatKg } from '@/lib/format';
import { LoadingState } from '@/components/states';
import { type ExportInvoice } from '@/features/export/types';
import { CompanyBlock, PrintLayout, Signatures, useCompany } from './PrintLayout';

const amt = (v: string) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function useInvoice(id: string) {
  return useQuery({ queryKey: ['print', 'export-invoice', id], queryFn: () => api.get<ExportInvoice>(`/export-invoices/${id}/print`) });
}

function Parties({ inv }: { inv: ExportInvoice }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
      <div>
        <div className="text-[10px] font-semibold uppercase">Buyer / consignee</div>
        <div className="font-semibold">{inv.buyer.name}</div>
        <div>{[inv.buyer.addressLine1, inv.buyer.addressLine2, inv.buyer.city, inv.buyer.country].filter(Boolean).join(', ')}</div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 text-[10px]">
        <span>Port of loading</span>
        <b>{inv.portOfLoading}</b>
        <span>Port of discharge</span>
        <b>{inv.portOfDischarge}</b>
        {inv.finalDestination ? (
          <>
            <span>Final destination</span>
            <b>{inv.finalDestination}</b>
          </>
        ) : null}
        <span>Country of destination</span>
        <b>{inv.countryOfDestination}</b>
        <span>Terms of delivery</span>
        <b>{inv.incoterm}</b>
        {inv.paymentTerms ? (
          <>
            <span>Payment</span>
            <b>{inv.paymentTerms}</b>
          </>
        ) : null}
        <span>Buyer PO</span>
        <b>{[...new Set(inv.lines.map((l) => l.order.buyerPoNo))].join(', ')}</b>
      </div>
    </div>
  );
}

/** Commercial / export invoice (A§11): company with GSTIN and IEC, buyer, ports, lines, LUT / IGST endorsement. */
export function ExportInvoicePrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useInvoice(id);
  if (!q.data || company.isLoading) return <LoadingState />;
  const inv = q.data;
  return (
    <PrintLayout size="A4" title={`Export invoice ${inv.docNo ?? ''}`}>
      <div className="flex items-start justify-between border-b-2 border-black pb-2">
        <div>
          <CompanyBlock c={company.data} />
          {company.data?.iec ? <div className="text-[10px] font-semibold">IEC: {company.data.iec}</div> : null}
        </div>
        <div className="text-right">
          <div className="text-base font-bold">EXPORT INVOICE</div>
          <div className="font-mono">{inv.docNo ?? 'DRAFT'}</div>
          <div>Date: {formatDate(inv.docDate)}</div>
          {inv.status === 'CANCELLED' ? <div className="font-bold text-red-700">CANCELLED</div> : null}
        </div>
      </div>
      <Parties inv={inv} />
      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="py-1">#</th>
            <th>Description (style · colour · size)</th>
            <th className="text-right">Pcs</th>
            <th className="text-right">Rate ({inv.currency})</th>
            <th className="text-right">Amount ({inv.currency})</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.id} className="border-b border-slate-300">
              <td className="py-0.5">{l.lineNo}</td>
              <td>
                {l.order.styleNo}
                {l.order.styleName ? ` ${l.order.styleName}` : ''} · {l.colour} · {l.size}
              </td>
              <td className="text-right">{l.pcs}</td>
              <td className="text-right">{l.unitPrice}</td>
              <td className="text-right">{amt(l.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-black font-bold">
            <td colSpan={2} className="py-1 text-right">
              Total {inv.incoterm}
            </td>
            <td className="text-right">{inv.totalPcs}</td>
            <td />
            <td className="text-right">
              {inv.currency} {amt(inv.fobValue)}
            </td>
          </tr>
        </tfoot>
      </table>
      <div className="mt-2 grid grid-cols-2 gap-4 text-[10px]">
        <div>
          Exchange rate: 1 {inv.currency} = ₹{inv.exchangeRate}
          <br />
          Value in INR: {formatInr(inv.inrValue)}
          {!inv.underLut ? (
            <>
              <br />
              IGST @ {inv.igstRatePct}%: {formatInr(inv.igstAmountInr)}
            </>
          ) : null}
        </div>
        <div className="text-right font-semibold">{inv.declaration}</div>
      </div>
      <p className="mt-3 text-[10px]">We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.</p>
      <Signatures labels={['Prepared by', 'Checked by', 'Authorised signatory']} />
    </PrintLayout>
  );
}

interface PlPrint {
  id: string;
  docNo: string | null;
  order: { orderNo: string; styleNo: string; buyerPoNo: string; sizes: string[] };
  cartons: { id: string; docNo: string | null; cartonSeq: number | null; grossKg: string | null; netKg: string | null; lines: { colour: string; size: string; pcs: number }[] }[];
}

/** Export packing list for the whole invoice: carton-wise across all its packing lists. */
export function ExportPackingListPrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useInvoice(id);
  const pls = useQuery({
    queryKey: ['print', 'export-pl', id, q.data?.packingLists.map((p) => p.id).join(',')],
    queryFn: () => Promise.all(q.data!.packingLists.map((p) => api.get<PlPrint>(`/packing-lists/${p.id}/print`))),
    enabled: !!q.data,
  });
  if (!q.data || !pls.data || company.isLoading) return <LoadingState />;
  const inv = q.data;
  const sizes = [...new Set(pls.data.flatMap((p) => p.order.sizes))];
  const cartons = pls.data.flatMap((p) => p.cartons.map((c) => ({ c, p })));
  const pcs = cartons.reduce((a, { c }) => a + c.lines.reduce((s, l) => s + l.pcs, 0), 0);
  const kg = (k: 'netKg' | 'grossKg') => cartons.reduce((a, { c }) => a + Number(c[k] ?? 0), 0);
  return (
    <PrintLayout size="A4" landscape title={`Packing list for ${inv.docNo ?? ''}`}>
      <div className="flex items-start justify-between border-b-2 border-black pb-2">
        <CompanyBlock c={company.data} />
        <div className="text-right">
          <div className="text-base font-bold">PACKING LIST</div>
          <div>
            Invoice <span className="font-mono">{inv.docNo ?? 'DRAFT'}</span> · {formatDate(inv.docDate)}
          </div>
        </div>
      </div>
      <Parties inv={inv} />
      <table className="mt-3 w-full border-collapse text-[10px]">
        <thead>
          <tr className="border-y border-black">
            <th className="text-left">Ctn</th>
            <th className="text-left">Carton no.</th>
            <th className="text-left">Order · style</th>
            <th className="text-left">Colour</th>
            {sizes.map((s) => (
              <th key={s} className="text-right">
                {s}
              </th>
            ))}
            <th className="text-right">Pcs</th>
            <th className="text-right">Net kg</th>
            <th className="text-right">Gross kg</th>
          </tr>
        </thead>
        <tbody>
          {cartons.flatMap(({ c, p }) => {
            const colours = [...new Set(c.lines.map((l) => l.colour))];
            return colours.map((col, i) => (
              <tr key={`${c.id}-${col}`} className="border-b border-slate-300">
                <td>{i === 0 ? c.cartonSeq : ''}</td>
                <td className="font-mono">{i === 0 ? c.docNo : ''}</td>
                <td>{i === 0 ? `${p.order.orderNo} · ${p.order.styleNo}` : ''}</td>
                <td>{col}</td>
                {sizes.map((s) => (
                  <td key={s} className="text-right">
                    {c.lines.find((l) => l.colour === col && l.size === s)?.pcs ?? ''}
                  </td>
                ))}
                <td className="text-right">{c.lines.filter((l) => l.colour === col).reduce((a, l) => a + l.pcs, 0)}</td>
                <td className="text-right">{i === 0 && c.netKg ? formatKg(c.netKg) : ''}</td>
                <td className="text-right">{i === 0 && c.grossKg ? formatKg(c.grossKg) : ''}</td>
              </tr>
            ));
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-black font-bold">
            <td colSpan={4 + sizes.length} className="py-1 text-right">
              {cartons.length} cartons
            </td>
            <td className="text-right">{pcs}</td>
            <td className="text-right">{kg('netKg').toFixed(3)}</td>
            <td className="text-right">{kg('grossKg').toFixed(3)}</td>
          </tr>
        </tfoot>
      </table>
      <Signatures labels={['Packed by', 'Checked by', 'Authorised signatory']} />
    </PrintLayout>
  );
}
