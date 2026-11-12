import { useQuery } from '@tanstack/react-query';
import { D, type DecimalLike } from '@wewin/shared';
import { api } from '@/lib/api';
import { formatDate, formatInr, formatKg, formatQty } from '@/lib/format';
import { LoadingState } from '@/components/states';
import type { Carton, SewingEntry, SewingIssue, TrimsDoc } from '@/features/production/FloorPages';
import type { PanelDc, RecutSlip } from '@/features/production/PanelPages';
import type { CutLay } from '@/features/production/CuttingPages';
import { BillDoc } from './BillDoc';

type Cert = { certificateNo?: string | null; certificateExpiry?: string | null };

function usePrintDoc<T>(doc: string, endpoint: string, id: string) {
  return useQuery({ queryKey: ['print', doc, id], queryFn: () => api.get<T>(`${endpoint}/${id}`) });
}

const orderLabel = (o: { orderNo: string; styleNo: string } | null | undefined) => (o ? `${o.orderNo} · ${o.styleNo}` : '');
const pcsTotal = (lines: { pcs: number }[]) => lines.reduce((a, l) => a + l.pcs, 0);
/** A quantity at its own scale (pieces stay whole, metres keep their decimals). */
const qty = (v: DecimalLike) => formatQty(v, D(v).decimalPlaces());

/** Colour × size lines, sorted by colour, then in the order they were entered. */
function cellRows(lines: { colour: string; size: string; pcs: number }[]) {
  return [...lines].sort((a, b) => a.colour.localeCompare(b.colour)).map((l) => [l.colour, l.size, formatQty(l.pcs)]);
}

// ── Sewing issue ──
export function SewingIssuePrint({ id }: { id: string }) {
  const q = usePrintDoc<SewingIssue>('sewing-issue', '/sewing-issues', id);
  if (!q.data) return <LoadingState />;
  const d = q.data;
  return (
    <BillDoc
      title="Sewing issue"
      docNo={d.docNo}
      docDate={d.docDate}
      status={d.status}
      party={{ label: 'Issued to', name: d.sewingLine }}
      details={[
        ['Order', orderLabel(d.order)],
        ['Bundles', formatQty(d.totals.bundles)],
        ['Pieces', formatQty(d.totals.pcs)],
      ]}
      columns={[{ header: 'Bundle no.' }, { header: 'Component' }, { header: 'Colour' }, { header: 'Size' }, { header: 'Pcs', align: 'right' }]}
      rows={d.lines.map((l) => [l.bundle.bundleNo ?? '', l.bundle.componentCode, l.bundle.colour, l.bundle.size, formatQty(l.pcs)])}
      totals={[`${d.totals.bundles} bundles`, null, null, null, formatQty(d.totals.pcs)]}
      remarks={d.remarks}
      signatures={['Issued by (cut panel store)', 'Received by (line supervisor)', 'Authorised signatory']}
    />
  );
}

// ── Sewing output ──
export function SewingOutputPrint({ id }: { id: string }) {
  const q = usePrintDoc<SewingEntry>('sewing-output', '/sewing-entries', id);
  if (!q.data) return <LoadingState />;
  const d = q.data;
  return (
    <BillDoc
      title="Sewing output"
      docNo={d.docNo}
      docDate={d.docDate}
      status={d.status}
      party={{ label: 'Sewing line', name: d.sewingLine, lines: [d.shift ? `Shift: ${d.shift}` : null] }}
      details={[
        ['Order', orderLabel(d.order)],
        ['Garments', formatQty(d.totals.garments)],
      ]}
      columns={[{ header: 'Colour' }, { header: 'Size' }, { header: 'Pcs produced', align: 'right' }]}
      rows={cellRows(d.lines)}
      totals={[null, null, formatQty(pcsTotal(d.lines))]}
      remarks={d.remarks}
      signatures={['Line supervisor', 'Production in-charge', 'Authorised signatory']}
    />
  );
}

// ── Carton ──
export function CartonPrint({ id }: { id: string }) {
  const q = usePrintDoc<Carton>('carton', '/cartons', id);
  if (!q.data) return <LoadingState />;
  const d = q.data;
  const dims = [d.lengthCm, d.widthCm, d.heightCm].every(Boolean) ? `${d.lengthCm} × ${d.widthCm} × ${d.heightCm} cm` : '';
  return (
    <BillDoc
      title="Carton"
      subtitle={d.cartonSeq ? `Carton #${d.cartonSeq}` : undefined}
      docNo={d.docNo}
      docDate={d.docDate}
      status={d.status}
      party={{ label: 'Buyer', name: d.order.buyer.name, lines: [d.order.buyerPoNo ? `Buyer PO: ${d.order.buyerPoNo}` : null] }}
      details={[
        ['Order', orderLabel(d.order)],
        ['Carton #', d.cartonSeq ? String(d.cartonSeq) : ''],
        ['Packing list', d.packingList?.docNo ?? ''],
        ['Gross kg', formatKg(d.grossKg)],
        ['Net kg', formatKg(d.netKg)],
        ['L × W × H', dims],
      ]}
      columns={[{ header: 'Colour' }, { header: 'Size' }, { header: 'Pcs', align: 'right' }]}
      rows={cellRows(d.lines)}
      totals={[null, null, formatQty(d.totalPcs)]}
      remarks={d.remarks}
      signatures={['Packed by', 'Checked by (QC)', 'Authorised signatory']}
    />
  );
}

// ── Trims receipt / issue / return / replacement / transfer ──
type TrimsPrintData = Omit<TrimsDoc, 'type' | 'vendor'> & {
  type: string;
  vendor: ({ name: string; gstin: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; pincode: string | null } & Cert) | null;
  toOrder?: { orderNo: string; styleNo: string } | null;
};
const TRIMS_TITLE: Record<string, string> = {
  RECEIPT: 'Trims receipt',
  ISSUE: 'Trims issue',
  RETURN: 'Trims return',
  REPLACEMENT: 'Trims replacement',
  TRANSFER: 'Trims transfer',
};

export function TrimsDocPrint({ id }: { id: string }) {
  const q = usePrintDoc<TrimsPrintData>('trims-doc', '/trims-docs', id);
  if (!q.data) return <LoadingState />;
  const d = q.data;
  const v = d.vendor;
  const priced = d.lines.some((l) => l.rate);
  const value = d.lines.reduce((a, l) => (l.amount ? a.plus(D(l.amount)) : a), D(0));
  return (
    <BillDoc
      title={TRIMS_TITLE[d.type] ?? 'Trims document'}
      docNo={d.docNo}
      docDate={d.docDate}
      status={d.status}
      party={
        v
          ? {
              label: d.type === 'RETURN' ? 'Returned to (supplier)' : 'Supplier',
              name: v.name,
              lines: [[v.addressLine1, v.addressLine2, v.city, v.pincode].filter(Boolean).join(', '), v.state, v.gstin ? `GSTIN: ${v.gstin}` : null],
              vendor: v,
            }
          : d.order
            ? { label: 'Issued to (order)', name: orderLabel(d.order) }
            : undefined
      }
      details={[
        ['Order', v ? orderLabel(d.order) : ''],
        ['To order', orderLabel(d.toOrder)],
        ['Supplier invoice no.', d.supplierInvoiceNo ?? ''],
      ]}
      columns={[
        { header: 'Item' },
        { header: 'Lot' },
        { header: 'Unit' },
        { header: 'Qty', align: 'right' },
        ...(priced ? [{ header: 'Rate ₹', align: 'right' as const }, { header: 'Amount ₹', align: 'right' as const }] : []),
      ]}
      rows={d.lines.map((l) => [
        l.item.name,
        l.lot,
        l.item.unit,
        qty(l.qty),
        ...(priced ? [l.rate ?? '', l.amount ? formatInr(l.amount, { symbol: false }) : ''] : []),
      ])}
      totals={[null, null, null, qty(d.totals.qty), ...(priced ? [null, formatInr(value.toFixed(2), { symbol: false })] : [])]}
      remarks={d.remarks}
      signatures={d.type === 'RECEIPT' ? ['Received by (trims store)', 'Checked by', 'Authorised signatory'] : ['Issued by (trims store)', 'Received by', 'Authorised signatory']}
    />
  );
}

// ── Panel inward ──
type PanelInPrintData = Omit<PanelDc, 'vendor'> & { vendor: PanelDc['vendor'] & Cert };

export function PanelInwardPrint({ id }: { id: string }) {
  const q = usePrintDoc<PanelInPrintData>('panel-inward', '/panel-dcs', id);
  if (!q.data) return <LoadingState />;
  const d = q.data;
  const v = d.vendor;
  const sent = d.lines.reduce((a, l) => a + (l.outLine?.pcs ?? 0), 0);
  const againstDcs = [...new Set(d.lines.map((l) => l.outLine?.dc.docNo).filter(Boolean))].join(', ');
  return (
    <BillDoc
      title="Panel inward"
      subtitle={d.process.name}
      docNo={d.docNo}
      docDate={d.docDate}
      status={d.status}
      party={{
        label: 'Received from',
        name: v.name,
        lines: [[v.addressLine1, v.city].filter(Boolean).join(', '), v.state ? `${v.state}${v.stateCode ? ` (${v.stateCode})` : ''}` : null, v.gstin ? `GSTIN: ${v.gstin}` : null],
        vendor: v,
      }}
      details={[
        ['Order', orderLabel(d.order)],
        ['Process', d.process.name],
        ['Against D.C.', againstDcs],
        ["Vendor's D.C. no.", d.vendorDcNo ?? ''],
        ['Vehicle no.', d.vehicleNo ?? ''],
      ]}
      columns={[
        { header: 'Our D.C.' },
        { header: 'Bundle no.' },
        { header: 'Panel' },
        { header: 'Colour / size' },
        { header: 'Sent', align: 'right' },
        { header: 'Good', align: 'right' },
        { header: 'Rejected', align: 'right' },
      ]}
      rows={d.lines.map((l) => [
        l.outLine?.dc.docNo ?? '',
        l.bundle.bundleNo ?? '',
        `${l.bundle.componentCode} · ${l.panelItem.name}`,
        `${l.colour} / ${l.size}`,
        l.outLine ? formatQty(l.outLine.pcs) : '',
        formatQty(l.goodPcs),
        formatQty(l.rejectedPcs),
      ])}
      totals={[null, `${d.totals.bundles} bundles`, null, null, formatQty(sent), formatQty(d.totals.good), formatQty(d.totals.rejected)]}
      remarks={d.remarks}
      signatures={['Received by (panel store)', 'Checked by (QC)', 'Authorised signatory']}
    />
  );
}

// ── Recut slip ──
type RecutPrintData = Omit<RecutSlip, 'lines'> & { lines: (RecutSlip['lines'][number] & { panelItem?: { name: string } | null })[] };

export function RecutSlipPrint({ id }: { id: string }) {
  const q = usePrintDoc<RecutPrintData>('recut-slip', '/recut-slips', id);
  if (!q.data) return <LoadingState />;
  const d = q.data;
  return (
    <BillDoc
      title="Recut slip"
      docNo={d.docNo}
      docDate={d.docDate}
      status={d.status}
      party={{ label: 'To', name: 'Cutting section' }}
      details={[
        ['Order', orderLabel(d.order)],
        ['Reason', d.reason],
        ['Pieces to recut', formatQty(d.totalPcs)],
      ]}
      columns={[{ header: 'Component' }, { header: 'Panel' }, { header: 'Colour' }, { header: 'Size' }, { header: 'Pcs', align: 'right' }]}
      rows={d.lines.map((l) => [l.componentCode, l.panelItem?.name ?? '', l.colour, l.size, formatQty(l.pcs)])}
      totals={[null, null, null, null, formatQty(d.totalPcs)]}
      signatures={['Requested by', 'Cutting in-charge', 'Authorised signatory']}
    />
  );
}

// ── Cutting lay ──
export function CutLayPrint({ id }: { id: string }) {
  const q = usePrintDoc<CutLay>('cut-lay', '/cut-lays', id);
  if (!q.data) return <LoadingState />;
  const d = q.data;
  const bySize = new Map<string, { bundles: number; pcs: number }>();
  for (const b of d.bundles) {
    const s = bySize.get(b.size) ?? { bundles: 0, pcs: 0 };
    bySize.set(b.size, { bundles: s.bundles + 1, pcs: s.pcs + b.pcs });
  }
  return (
    <BillDoc
      title="Cutting lay"
      docNo={d.docNo}
      docDate={d.docDate}
      status={d.status}
      party={{ label: 'Buyer', name: d.order.buyer.name, lines: [`Order: ${orderLabel(d.order)}`] }}
      details={[
        ['Colour', d.colour],
        ['Plies', d.plies !== null ? formatQty(d.plies) : ''],
        ['Marker length', d.markerLength ?? ''],
        ['Pcs per bundle', d.pcsPerBundle !== null ? formatQty(d.pcsPerBundle) : ''],
        ['Fabric used (kg)', formatKg(d.totals.fabricKg)],
        ['Approval', d.approvalStatus === 'APPROVED' ? `Approved${d.approvedBy ? ` by ${d.approvedBy.fullName}` : ''}${d.approvedAt ? ` on ${formatDate(d.approvedAt)}` : ''}` : d.approvalStatus === 'PENDING' ? 'Pending' : ''],
      ]}
      columns={[{ header: 'Bundle no.' }, { header: 'Component' }, { header: 'Panel' }, { header: 'Colour' }, { header: 'Size' }, { header: 'Pcs', align: 'right' }]}
      rows={d.bundles.map((b) => [b.bundleNo ?? '', b.componentCode, b.panelItem.name, b.colour, b.size, formatQty(b.pcs)])}
      totals={[`${d.totals.bundles} bundles`, null, null, null, null, formatQty(d.totals.pcs)]}
      after={
        <div className="mt-3 grid grid-cols-[2fr_1fr] gap-4">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-black">
                <th className="py-1 text-left">Roll no.</th>
                <th className="text-left">Fabric</th>
                <th className="text-left">Lot / colour</th>
                <th className="text-right">GSM / dia</th>
                <th className="text-right">Kg used</th>
              </tr>
            </thead>
            <tbody>
              {d.rolls.map((r) => (
                <tr key={r.id} className="border-b border-slate-300">
                  <td className="py-0.5 font-mono">{r.roll.rollNo}</td>
                  <td>{r.roll.item.name}</td>
                  <td>
                    {r.roll.lot} / {r.roll.colour}
                  </td>
                  <td className="text-right">{[r.roll.gsm, r.roll.dia].filter((x) => x !== null && x !== '').join(' / ')}</td>
                  <td className="text-right">{formatKg(r.kgUsed)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-b border-black font-bold">
                <td className="py-1" colSpan={4}>
                  Rolls consumed: {d.rolls.length}
                </td>
                <td className="text-right">{formatKg(d.totals.fabricKg)}</td>
              </tr>
            </tfoot>
          </table>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-black">
                <th className="py-1 text-left">Size</th>
                <th className="text-right">Bundles</th>
                <th className="text-right">Pcs</th>
              </tr>
            </thead>
            <tbody>
              {[...bySize].map(([size, s]) => (
                <tr key={size} className="border-b border-slate-300">
                  <td className="py-0.5">{size}</td>
                  <td className="text-right">{s.bundles}</td>
                  <td className="text-right">{formatQty(s.pcs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
      remarks={d.remarks}
      signatures={['Cutting master', 'Checked by', 'Authorised signatory']}
    />
  );
}
