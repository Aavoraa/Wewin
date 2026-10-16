import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDate, formatInr } from '@/lib/format';
import { LoadingState } from '@/components/states';
import { type DebitNote, type Payment } from '@/features/accounts/types';
import { CompanyBlock, PrintLayout, Signatures, useCompany } from './PrintLayout';

const REASON: Record<string, string> = { EXCESS_LOSS: 'Excess process loss', PANEL_REJECT: 'Rejected panels', PANEL_MISSING: 'Missing panels', MANUAL: '' };

/** Debit note to the vendor (A§11): company, vendor GSTIN, reasons, amounts, GST when applicable. */
export function DebitNotePrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useQuery({ queryKey: ['print', 'debit-note', id], queryFn: () => api.get<DebitNote>(`/debit-notes/${id}/print`) });
  if (!q.data) return <LoadingState />;
  const n = q.data;
  const lines = n.lines.filter((l) => l.active || n.status !== 'POSTED');
  return (
    <PrintLayout size="A4" title={`Debit note ${n.docNo ?? ''}`}>
      <div className="flex items-start justify-between border-b border-black pb-2">
        <CompanyBlock c={company.data} />
        <div className="text-right">
          <div className="text-lg font-bold">DEBIT NOTE</div>
          <div className="font-mono">{n.docNo ?? 'DRAFT'}</div>
          <div>Date: {formatDate(n.docDate)}</div>
          {n.status === 'CANCELLED' ? <div className="font-bold text-red-700">CANCELLED</div> : null}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase">To</div>
          <div className="font-semibold">{n.vendor.name}</div>
          <div>{[n.vendor.addressLine1, n.vendor.city, n.vendor.state].filter(Boolean).join(', ')}</div>
          {n.vendor.gstin ? <div>GSTIN: {n.vendor.gstin}</div> : null}
        </div>
        <div>
          {n.bill ? (
            <>
              <div className="text-[10px] font-semibold uppercase">Against</div>
              <div>
                Your invoice {n.bill.vendorInvoiceNo} (our ref. {n.bill.docNo})
              </div>
            </>
          ) : null}
          {n.remarks ? <div className="mt-1">{n.remarks}</div> : null}
        </div>
      </div>
      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="py-1">#</th>
            <th>Particulars</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Rate ₹</th>
            <th className="text-right">Amount ₹</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id} className="border-b border-slate-300 align-top">
              <td className="py-1">{i + 1}</td>
              <td>
                {REASON[l.reason] ? <div className="font-semibold">{REASON[l.reason]}</div> : null}
                {l.description}
              </td>
              <td className="text-right">
                {l.qty} {l.unit.toLowerCase()}
              </td>
              <td className="text-right">{l.rate}</td>
              <td className="text-right">{formatInr(l.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="pt-1 text-right">
              Taxable value
            </td>
            <td className="pt-1 text-right">{formatInr(n.taxableAmount)}</td>
          </tr>
          {n.gstRatePct ? (
            <tr>
              <td colSpan={4} className="text-right">
                GST @ {n.gstRatePct}%
              </td>
              <td className="text-right">{formatInr(n.gstAmount)}</td>
            </tr>
          ) : null}
          <tr className="border-t border-black font-bold">
            <td colSpan={4} className="py-1 text-right">
              Total debit
            </td>
            <td className="py-1 text-right">{formatInr(n.totalAmount)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-3 text-[10px]">We have debited your account with the above amount. It will be adjusted against your bill payment.</p>
      <Signatures labels={['Prepared by', 'Checked by', 'Authorised signatory']} />
    </PrintLayout>
  );
}

/** Payment voucher (A§11): vendor, mode / UTR, bills settled, TDS, advance. */
export function PaymentVoucherPrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useQuery({ queryKey: ['print', 'payment', id], queryFn: () => api.get<Payment>(`/payments/${id}/print`) });
  if (!q.data) return <LoadingState />;
  const p = q.data;
  return (
    <PrintLayout size="A5" landscape title={`Payment voucher ${p.docNo ?? ''}`}>
      <div className="flex items-start justify-between border-b border-black pb-2">
        <CompanyBlock c={company.data} />
        <div className="text-right">
          <div className="text-base font-bold">PAYMENT VOUCHER</div>
          <div className="font-mono">{p.docNo ?? 'DRAFT'}</div>
          <div>Date: {formatDate(p.docDate)}</div>
          {p.status === 'CANCELLED' ? <div className="font-bold text-red-700">CANCELLED</div> : null}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase">Paid to</div>
          <div className="font-semibold">{p.vendor.name}</div>
          {p.vendor.bankAccount ? (
            <div>
              {p.vendor.bankName} A/c {p.vendor.bankAccount} {p.vendor.bankIfsc ? `IFSC ${p.vendor.bankIfsc}` : ''}
            </div>
          ) : null}
        </div>
        <div>
          <div>
            Mode: <b>{p.mode}</b> {p.reference ? `· ${p.reference}` : ''}
          </div>
          {p.bankAccount ? <div>From: {p.bankAccount}</div> : null}
          {p.remarks ? <div>{p.remarks}</div> : null}
        </div>
      </div>
      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="py-1">Bill</th>
            <th>Vendor invoice</th>
            <th>Invoice date</th>
            <th className="text-right">Amount ₹</th>
          </tr>
        </thead>
        <tbody>
          {p.allocations.map((a) => (
            <tr key={a.id} className="border-b border-slate-300">
              <td className="py-1 font-mono">{a.bill.docNo}</td>
              <td>{a.bill.vendorInvoiceNo}</td>
              <td>{formatDate(a.bill.vendorInvoiceDate)}</td>
              <td className="text-right">{formatInr(a.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="pt-1 text-right">
              Amount paid
            </td>
            <td className="pt-1 text-right font-bold">{formatInr(p.amount)}</td>
          </tr>
          {p.tdsAmount !== '0.00' ? (
            <tr>
              <td colSpan={3} className="text-right">
                TDS deducted
              </td>
              <td className="text-right">{formatInr(p.tdsAmount)}</td>
            </tr>
          ) : null}
          <tr>
            <td colSpan={3} className="text-right">
              {p.unallocated.startsWith('-') ? 'Adjusted from advance' : 'On account (advance)'}
            </td>
            <td className="text-right">{formatInr(p.unallocated.replace('-', ''))}</td>
          </tr>
        </tfoot>
      </table>
      <Signatures labels={['Prepared by', 'Approved by', "Receiver's signature"]} />
    </PrintLayout>
  );
}
