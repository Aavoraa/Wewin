import { useQuery } from '@tanstack/react-query';
import { D, amountInWords } from '@wewin/shared';
import { api } from '@/lib/api';
import { formatDate, formatInr, formatQty } from '@/lib/format';
import { LoadingState } from '@/components/states';
import { type BuyerReceipt, type Shipment } from '@/features/export/types';
import { BillDoc } from './BillDoc';

/** Foreign-currency amount, same style as the export invoice print. */
const amt = (v: string) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fc = (cur: string, v: string) => `${cur} ${amt(v)}`;

/** Shipment advice: buyer, shipping bill / B/L or AWB, vessel, container, and the export invoices shipped. */
export function ShipmentPrint({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['print', 'shipment', id], queryFn: () => api.get<Shipment>(`/shipments/${id}`) });
  if (!q.data) return <LoadingState />;
  const s = q.data;
  const sea = s.mode === 'SEA';
  const invoices = s.status === 'DRAFT' && s.invoices.length === 0 ? s.draftInvoices : s.invoices;
  const pcs = invoices.reduce((a, i) => a.plus(D(i.totalPcs)), D(0));
  const byCurrency = new Map<string, ReturnType<typeof D>>();
  for (const i of invoices) byCurrency.set(i.currency, (byCurrency.get(i.currency) ?? D(0)).plus(D(i.fobValue)));
  const valueTotal = [...byCurrency.entries()].map(([cur, v]) => fc(cur, v.toFixed(2))).join(' + ');
  const loading = [...new Set(invoices.map((i) => i.portOfLoading).filter(Boolean))].join(', ');
  const discharge = [...new Set(invoices.map((i) => i.portOfDischarge).filter(Boolean))].join(', ');
  return (
    <BillDoc
      title="SHIPMENT ADVICE"
      docNo={s.docNo}
      docDate={s.docDate}
      status={s.status}
      party={{ label: 'Buyer / consignee', name: s.buyer.name, lines: [s.buyer.country] }}
      details={[
        ['Mode', s.mode],
        ['Shipping bill no.', s.shippingBillNo],
        ['Shipping bill date', s.shippingBillDate ? formatDate(s.shippingBillDate) : null],
        ['Port code', s.portCode],
        [sea ? 'B/L no.' : 'AWB / docket no.', s.blAwbNo],
        [sea ? 'B/L date' : 'AWB date', s.blAwbDate ? formatDate(s.blAwbDate) : null],
        ['Carrier / line', s.carrier],
        [sea ? 'Vessel / voyage' : 'Flight', s.vesselFlight],
        ['Container no.', s.containerNo],
        ['Seal no.', s.sealNo],
        ['Forwarder', s.forwarder],
        ['Port of loading', loading],
        ['Port of discharge', discharge],
        ['ETD', s.etd ? formatDate(s.etd) : null],
        ['ETA', s.eta ? formatDate(s.eta) : null],
      ]}
      columns={[{ header: 'Export invoice' }, { header: 'Date' }, { header: 'Discharge port' }, { header: 'Pcs', align: 'right' }, { header: 'Value', align: 'right' }]}
      rows={invoices.map((i) => [<span className="font-mono">{i.docNo ?? 'DRAFT'}</span>, i.docDate ? formatDate(i.docDate) : '', i.portOfDischarge, formatQty(i.totalPcs), fc(i.currency, i.fobValue)])}
      totals={[`${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`, null, null, formatQty(pcs.toString()), valueTotal]}
      remarks={s.remarks}
      signatures={['Prepared by', 'Checked by', 'Authorised signatory']}
    />
  );
}

/** Buyer receipt: export proceeds received, exchange rate, INR credited, and the invoices realised. */
export function BuyerReceiptPrint({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['print', 'buyer-receipt', id], queryFn: () => api.get<BuyerReceipt>(`/buyer-receipts/${id}`) });
  if (!q.data) return <LoadingState />;
  const r = q.data;
  const allocated = r.allocations.reduce((a, x) => a.plus(D(x.amountFc)), D(0));
  return (
    <BillDoc
      title="BUYER RECEIPT"
      subtitle="Payment received"
      docNo={r.docNo}
      docDate={r.docDate}
      status={r.status}
      party={{ label: 'Received from (buyer)', name: r.buyer.name, lines: [r.buyer.country] }}
      details={[
        ['Credit date', formatDate(r.docDate)],
        ['Amount credited', fc(r.currency, r.amountFc)],
        ['Bank charges', D(r.bankChargesFc).isZero() ? null : fc(r.currency, r.bankChargesFc)],
        ['Exchange rate', `1 ${r.currency} = ₹${r.exchangeRate}`],
        ['INR credited', formatInr(r.amountInr)],
        ['Bank reference', r.bankReference],
        ['FIRA / e-BRC no.', r.firaNo],
      ]}
      columns={[{ header: 'Export invoice' }, { header: 'Invoice date' }, { header: 'Invoice value', align: 'right' }, { header: 'Invoice rate (₹)', align: 'right' }, { header: `Allocated (${r.currency})`, align: 'right' }]}
      rows={r.allocations.map((a) => [<span className="font-mono">{a.invoice.docNo}</span>, a.invoice.docDate ? formatDate(a.invoice.docDate) : '', fc(a.invoice.currency, a.invoice.fobValue), a.invoice.exchangeRate, amt(a.amountFc)])}
      totals={[null, null, null, null, fc(r.currency, allocated.toFixed(2))]}
      after={
        <div className="mt-2 grid grid-cols-2 gap-4 text-[10px]">
          <div>
            Received {fc(r.currency, r.amountFc)}
            {D(r.bankChargesFc).isZero() ? null : ` + bank charges ${fc(r.currency, r.bankChargesFc)}`}
            <br />
            Allocated to invoices: {fc(r.currency, r.allocatedFc)}
            <br />
            On account: {fc(r.currency, r.unallocatedFc)}
          </div>
          <div className="text-right">
            Value in INR: <b>{formatInr(r.amountInr)}</b>
          </div>
          <div className="col-span-2 font-semibold">Amount received in words: {amountInWords(r.amountFc, r.currency)}</div>
        </div>
      }
      remarks={r.remarks}
      signatures={['Prepared by', 'Checked by', 'Authorised signatory']}
    />
  );
}
