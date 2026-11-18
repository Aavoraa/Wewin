import { useQuery } from '@tanstack/react-query';
import { D, rupeesInWords } from '@wewin/shared';
import { api } from '@/lib/api';
import { formatDate, formatDateTimeIst, formatInr, formatKg, formatPct, formatQty } from '@/lib/format';
import { LoadingState } from '@/components/states';
import { type VendorBill } from '@/features/accounts/types';
import { CompanyBlock, PrintLayout, VendorCertificate, useCompany } from './PrintLayout';

interface AccessoryItem {
  receiptId: string;
  receiptNo: string;
  partyDcNo: string | null;
  docDate: string;
  itemName: string;
  colour: string | null;
  size: string | null;
  unit: string;
  qty: string;
  rate: string | null;
  poNo: string | null;
  poRate: string | null;
}
interface PoPosition {
  poLineId: string;
  poNo: string;
  item: string;
  colour: string | null;
  size: string | null;
  unit: string;
  poQty: string;
  receivedQty: string;
  balance: string;
}
interface CheckList {
  bill: VendorBill & { postedAt: string | null };
  buyer: string | null;
  accessoryItems: AccessoryItem[];
  poLines: PoPosition[];
  lines: (VendorBill['lines'][number] & { partyDcNo: string | null; items: string | null; lots: string | null; processName: string | null; billRate: string | null; billedQty: string; amount: string | null })[];
  reconciliation: {
    outwardId: string;
    docNo: string | null;
    docDate: string;
    programNo: string;
    process: string;
    items: string;
    lots: string;
    sentKg: string;
    receivedKg: string;
    lossKg: string;
    lossPct: string;
    allowedPct: string;
    excessKg: string;
    final: boolean;
    debitKg: string;
    debitAmount: string;
    colours: string;
  }[];
  people: { postedBy: string | null; audit1By: string | null; audit2By: string | null };
}

const qty = (q: string, unit: string) => (unit === 'KG' ? formatKg(q) : formatQty(q));
const AUDIT: Record<string, string> = { PENDING: 'Pending', PASSED: 'Passed', HELD: 'Held' };

/**
 * Bill check list (Q-078), after the desktop "Knitting Bill Check List": bill header, billed D.C.s
 * with bill rate against contract rate, the reconciliation of the outward D.C.s behind them, the
 * abstract (gross, tax, net, debit notes, balance) and the 1st / 2nd audit sign-off.
 */
export function BillCheckListPrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useQuery({ queryKey: ['print', 'bill-check-list', id], queryFn: () => api.get<CheckList>(`/vendor-bills/${id}/check-list`) });
  if (!q.data || company.isLoading) return <LoadingState />;
  const { bill: b, lines, reconciliation: rec, people } = q.data;
  const processes = [...new Set(rec.map((r) => r.process))];
  const acc = b.kind === 'ACCESSORY';
  const title = acc ? 'Accessories Purchase Bill Chk.List' : b.kind === 'PURCHASE' ? 'Purchase Bill Check List' : processes.length === 1 ? `${processes[0]} Bill Check List` : 'Job Work Bill Check List';
  const f = b.figures;
  const auditLine = (lvl: 1 | 2) => {
    const status = lvl === 1 ? b.audit1Status : b.audit2Status;
    const who = lvl === 1 ? people.audit1By : people.audit2By;
    const at = lvl === 1 ? b.audit1At : b.audit2At;
    const note = lvl === 1 ? b.audit1Note : b.audit2Note;
    return (
      <div className="flex flex-col justify-end text-center text-[10px]">
        <div className="mb-0.5 min-h-8 font-semibold">
          {AUDIT[status]}
          {who ? ` — ${who}` : ''}
          {at ? <div className="font-normal">{formatDateTimeIst(at)}</div> : null}
          {note ? <div className="font-normal italic">{note}</div> : null}
        </div>
        <div className="border-t border-black pt-1">{lvl === 1 ? '1st audit' : '2nd audit'}</div>
      </div>
    );
  };
  return (
    <PrintLayout title={`Check list ${b.docNo ?? ''}`}>
      <div className="flex items-start justify-between border-b-2 border-black pb-2">
        <CompanyBlock c={company.data} />
        <div className="border border-black px-3 py-1 text-sm font-bold">{title}</div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-0.5 border-b border-black pb-2">
        <div>
          BR No.: <b>{b.docNo ?? 'DRAFT'}</b>
        </div>
        <div>
          Supplier: <b>{b.vendor.name}</b>
        </div>
        <div>
          Bill no.: <b>{b.vendorInvoiceNo}</b>
        </div>
        <div>
          Bill amount: <b>{formatInr(f.invoiceTotal)}</b>
        </div>
        <div>
          <VendorCertificate v={b.vendor} className="text-[10px]" />
        </div>
        <div>
          Bill date: <b>{formatDate(b.vendorInvoiceDate)}</b>
        </div>
        <div className="col-span-2">
          Ord. ref.: <b>{b.order ? `${b.order.orderNo} · ${b.order.styleNo}` : '—'}</b>
        </div>
        <div>
          Buyer: <b>{q.data.buyer ?? '—'}</b>
        </div>
      </div>

      {acc ? <AccessoryTables items={q.data.accessoryItems} poLines={q.data.poLines} taxable={b.taxableAmount} /> : (
      <table className="mt-2 w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="py-1">Party D.C.</th>
            <th>Our D.C.</th>
            <th>Date</th>
            <th>Item description</th>
            <th>Lot</th>
            <th>Process</th>
            <th>UoM</th>
            <th className="text-right">GRN qty</th>
            <th className="text-right">Bill qty</th>
            <th className="text-right">B.Rate</th>
            <th className="text-right">Q.Rate</th>
            <th className="text-right">Amount ₹</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b border-slate-300 align-top">
              <td className="py-0.5">{l.partyDcNo ?? '—'}</td>
              <td>{l.sourceDocNo}</td>
              <td>{formatDate(l.sourceDate)}</td>
              <td>
                {l.details?.fabricDescription || l.items || (l.sourceType === 'PANEL_IN' ? 'Panels (good pcs)' : l.sourceType === 'YARN_RECEIPT' ? 'Yarn receipt' : l.sourceType === 'STOCK_INWARD' ? 'Inward from others' : '')}
                {l.details ? (
                  <div className="text-[10px] leading-tight">
                    {[
                      l.details.orderNo,
                      l.details.colours,
                      l.details.gsm ? `GSM ${l.details.gsm}` : null,
                      l.details.gauge ? `GG ${l.details.gauge}` : null,
                      l.details.loopLength ? `LL ${l.details.loopLength}` : null,
                      l.details.rolls ? `${l.details.rolls} rolls` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                ) : null}
              </td>
              <td>{l.lots || '—'}</td>
              <td>{l.processName || '—'}</td>
              <td>{l.unit === 'KG' ? 'KGS' : l.unit}</td>
              <td className="text-right">{qty(l.billableQty, l.unit)}</td>
              <td className="text-right">{qty(l.billedQty ?? l.billableQty, l.unit)}</td>
              <td className={`text-right ${l.billRate && l.rate && l.billRate !== Number(l.rate).toFixed(2) ? 'font-bold' : ''}`}>{l.billRate ?? '—'}</td>
              <td className="text-right">{l.rate ?? '—'}</td>
              <td className="text-right">{l.amount ? formatInr(l.amount, { symbol: false }) : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-b border-black font-bold">
            <td colSpan={11} className="py-1 text-right">
              Expected {formatInr(b.expectedTaxable)} · Invoiced taxable
            </td>
            <td className="text-right">{formatInr(b.taxableAmount, { symbol: false })}</td>
          </tr>
        </tfoot>
      </table>
      )}

      {rec.length ? (
        <>
          <div className="mt-3 font-semibold">Material reconciliation (outward D.C.s behind this bill)</div>
          <table className="mt-1 w-full border-collapse">
            <thead>
              <tr className="border-y border-black text-left">
                <th className="py-1">Our D.C.</th>
                <th>Prog. no.</th>
                <th>Colour / fabric</th>
                <th>Lot</th>
                <th>UoM</th>
                <th className="text-right">Send qty</th>
                <th className="text-right">Recd qty</th>
                <th className="text-right">Balance</th>
                <th className="text-right">%</th>
                <th className="text-right">Allowed %</th>
                <th className="text-right">Excess</th>
                <th className="text-right">Debit</th>
              </tr>
            </thead>
            <tbody>
              {rec.map((r) => (
                <tr key={r.outwardId} className="border-b border-slate-300 align-top">
                  <td className="py-0.5">
                    {r.docNo} <span className="text-[10px]">({formatDate(r.docDate)})</span>
                  </td>
                  <td>{r.programNo}</td>
                  <td>{[r.colours, r.items].filter(Boolean).join(' - ')}</td>
                  <td>{r.lots || '—'}</td>
                  <td>KGS</td>
                  <td className="text-right">{formatKg(r.sentKg)}</td>
                  <td className="text-right">{formatKg(r.receivedKg)}</td>
                  <td className="text-right">{formatKg(r.lossKg)}</td>
                  <td className="text-right">
                    {formatPct(r.lossPct)}
                    {r.final ? '' : '*'}
                  </td>
                  <td className="text-right">{formatPct(r.allowedPct)}</td>
                  <td className={`text-right ${Number(r.excessKg) > 0 ? 'font-bold' : ''}`}>{formatKg(r.excessKg)}</td>
                  <td className="text-right">
                    {Number(r.debitKg) ? (
                      <>
                        {formatKg(r.debitKg)}
                        <div className="text-[10px]">₹{formatInr(r.debitAmount, { symbol: false })}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-y border-black font-bold">
                <td colSpan={5} className="py-1">
                  Total
                </td>
                <td className="text-right">{formatKg(rec.reduce((a, r) => a.plus(D(r.sentKg)), D(0)).toFixed(3))}</td>
                <td className="text-right">{formatKg(rec.reduce((a, r) => a.plus(D(r.receivedKg)), D(0)).toFixed(3))}</td>
                <td className="text-right">{formatKg(rec.reduce((a, r) => a.plus(D(r.lossKg)), D(0)).toFixed(3))}</td>
                <td colSpan={2} />
                <td className="text-right">{formatKg(rec.reduce((a, r) => a.plus(D(r.excessKg)), D(0)).toFixed(3))}</td>
                <td className="text-right">{formatKg(rec.reduce((a, r) => a.plus(D(r.debitKg)), D(0)).toFixed(3))}</td>
              </tr>
            </tfoot>
          </table>
          {rec.some((r) => !r.final) ? <div className="text-[10px]">* D.C. still open: running loss, not final.</div> : null}
        </>
      ) : null}

      <div className="mt-3 font-semibold underline">Abstract</div>
      <table className="mt-1 w-[110mm] border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="py-1">Description</th>
            <th className="text-right">Amount ₹</th>
            <th className="text-right">Debit ₹</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-0.5">Gross amount</td>
            <td className="text-right">{formatInr(b.taxableAmount, { symbol: false })}</td>
            <td />
          </tr>
          {Number(b.taxablePct) !== 100 || b.taxType ? (
            <tr>
              <td className="py-0.5 text-[10px]" colSpan={3}>
                Tax type {b.taxType === 'NONE' ? 'No tax' : (b.taxType ?? 'by supplier state')}
                {b.gstRatePct && b.taxType !== 'NONE' ? ` @ ${Number(b.gstRatePct)} %` : ''}
                {Number(b.taxablePct) !== 100 ? ` on ${Number(b.taxablePct)} % of gross` : ''}
              </td>
            </tr>
          ) : null}
          {[
            ['CGST', b.cgstAmount],
            ['SGST', b.sgstAmount],
            ['IGST', b.igstAmount],
          ]
            .filter(([, v]) => Number(v))
            .map(([k, v]) => (
              <tr key={k}>
                <td className="py-0.5">{k}</td>
                <td className="text-right">{formatInr(v!, { symbol: false })}</td>
                <td />
              </tr>
            ))}
          {Number(b.discountAmount) ? (
            <tr>
              <td className="py-0.5">Discount{b.discountPct ? ` @ ${Number(b.discountPct)} %` : ''}</td>
              <td className="text-right">({formatInr(b.discountAmount, { symbol: false })})</td>
              <td />
            </tr>
          ) : null}
          {Number(b.packingAmount) ? (
            <tr>
              <td className="py-0.5">Packing &amp; forwarding</td>
              <td className="text-right">{formatInr(b.packingAmount, { symbol: false })}</td>
              <td />
            </tr>
          ) : null}
          {Number(b.tcsAmount) ? (
            <tr>
              <td className="py-0.5">TCS{b.tcsPct ? ` @ ${Number(b.tcsPct)} %` : ''}</td>
              <td className="text-right">{formatInr(b.tcsAmount, { symbol: false })}</td>
              <td />
            </tr>
          ) : null}
          {Number(b.addAmount) ? (
            <tr>
              <td className="py-0.5">Add amount</td>
              <td className="text-right">{formatInr(b.addAmount, { symbol: false })}</td>
              <td />
            </tr>
          ) : null}
          {Number(b.lessAmount) ? (
            <tr>
              <td className="py-0.5">Less amount</td>
              <td className="text-right">({formatInr(b.lessAmount, { symbol: false })})</td>
              <td />
            </tr>
          ) : null}
          <tr className="border-t border-black font-semibold">
            <td className="py-0.5">Net amount</td>
            <td className="text-right">{formatInr(f.invoiceTotal, { symbol: false })}</td>
            <td className="text-right">{formatInr(f.debitNotesTotal, { symbol: false })}</td>
          </tr>
          <tr className="border-y border-black font-bold">
            <td className="py-1">Balance (net payable)</td>
            <td className="text-right">{formatInr(f.netPayable, { symbol: false })}</td>
            <td />
          </tr>
        </tbody>
      </table>
      {b.debitNotes.length ? <div className="text-[10px]">Debit notes: {b.debitNotes.map((n) => n.docNo).join(', ')}</div> : null}
      <div className="mt-3">Rupees {rupeesInWords(f.netPayable)}</div>

      <div className="mt-10 grid grid-cols-3 gap-6">
        <div className="flex flex-col justify-end text-center text-[10px]">
          <div className="mb-0.5 min-h-8 font-semibold">
            {people.postedBy ?? ''}
            {b.postedAt ? <div className="font-normal">{formatDateTimeIst(b.postedAt)}</div> : null}
          </div>
          <div className="border-t border-black pt-1">Bill entered by</div>
        </div>
        {auditLine(1)}
        {auditLine(2)}
      </div>
    </PrintLayout>
  );
}

/**
 * Accessories bill check list (Q-089), as the desktop print: each received item with GRN / bill qty,
 * PO rate and bill rate; then each PO line behind the receipts with PO qty, received qty and balance.
 */
function AccessoryTables({ items, poLines, taxable }: { items: AccessoryItem[]; poLines: PoPosition[]; taxable: string }) {
  const rateOf = (i: AccessoryItem) => (i.rate !== null ? D(i.rate) : i.poRate ? D(i.poRate.split('/')[0]!).div(D(i.poRate.split('/')[1] || '1')) : null);
  const total = items.reduce((a, i) => a.plus(D(i.qty)), D(0));
  return (
    <>
      <table className="mt-2 w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="py-1">P.DC</th>
            <th>GRN</th>
            <th>Date</th>
            <th>Acc. description</th>
            <th>Colour</th>
            <th>Size</th>
            <th>UoM</th>
            <th className="text-right">GRN qty</th>
            <th className="text-right">Bill qty</th>
            <th className="text-right">PO rate</th>
            <th className="text-right">Bill rate</th>
            <th className="text-right">Amount ₹</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, n) => {
            const r = rateOf(i);
            return (
              <tr key={`${i.receiptId}-${n}`} className="border-b border-slate-300 align-top">
                <td className="py-0.5">{i.partyDcNo ?? '—'}</td>
                <td>{i.receiptNo}</td>
                <td>{formatDate(i.docDate)}</td>
                <td>{i.itemName}</td>
                <td>{i.colour || '—'}</td>
                <td>{i.size || '—'}</td>
                <td>{i.unit}</td>
                <td className="text-right">{formatQty(i.qty)}</td>
                <td className="text-right">{formatQty(i.qty)}</td>
                <td className="text-right">{i.poRate ?? '—'}</td>
                <td className={`text-right ${r && i.poRate && i.rate !== null && !r.equals(rateOf({ ...i, rate: null }) ?? r) ? 'font-bold' : ''}`}>{r ? r.toFixed(2) : '—'}</td>
                <td className="text-right">{r ? formatInr(D(i.qty).times(r).toFixed(2), { symbol: false }) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-b border-black font-bold">
            <td colSpan={7} className="py-1 text-right">
              Total
            </td>
            <td className="text-right">{formatQty(total.toFixed(3))}</td>
            <td className="text-right">{formatQty(total.toFixed(3))}</td>
            <td colSpan={2} className="text-right">
              Invoiced taxable
            </td>
            <td className="text-right">{formatInr(taxable, { symbol: false })}</td>
          </tr>
        </tfoot>
      </table>
      {poLines.length ? (
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-y border-black text-left">
              <th className="py-1">PO no.</th>
              <th>Item description</th>
              <th>Colour</th>
              <th>Size</th>
              <th>UoM</th>
              <th className="text-right">PO qty</th>
              <th className="text-right">Recd qty</th>
              <th className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {poLines.map((p) => (
              <tr key={p.poLineId} className="border-b border-slate-300">
                <td className="py-0.5">{p.poNo}</td>
                <td>{p.item}</td>
                <td>{p.colour || '—'}</td>
                <td>{p.size || '—'}</td>
                <td>{p.unit}</td>
                <td className="text-right">{formatQty(p.poQty)}</td>
                <td className="text-right">{formatQty(p.receivedQty)}</td>
                <td className={`text-right ${Number(p.balance) > 0 ? 'font-bold' : ''}`}>{Number(p.balance) ? formatQty(p.balance) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-y border-black font-bold">
              <td colSpan={5} className="py-1">
                Total
              </td>
              <td className="text-right">{formatQty(poLines.reduce((a, p) => a.plus(D(p.poQty)), D(0)).toFixed(3))}</td>
              <td className="text-right">{formatQty(poLines.reduce((a, p) => a.plus(D(p.receivedQty)), D(0)).toFixed(3))}</td>
              <td className="text-right">{formatQty(poLines.reduce((a, p) => a.plus(D(p.balance)), D(0)).toFixed(3))}</td>
            </tr>
          </tfoot>
        </table>
      ) : null}
    </>
  );
}
