import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDate, formatKg, formatQty } from '@/lib/format';
import { useQr } from '@/lib/qr';
import { LoadingState } from '@/components/states';
import { type CutLay } from '@/features/production/CuttingPages';
import { type PanelDc } from '@/features/production/PanelPages';
import { CompanyBlock, PrintLayout, Signatures, useCompany } from './PrintLayout';

function BundleTicket({ no, order, style, colour, size, component, pcs }: { no: string; order: string; style: string; colour: string; size: string; component: string; pcs: number }) {
  const qr = useQr(no, 130);
  return (
    <div className="print-break flex h-[56mm] w-[96mm] gap-2 border border-dashed border-slate-300 p-1 print:border-0">
      {qr ? <img src={qr} alt={`QR ${no}`} className="size-[32mm]" /> : <div className="size-[32mm]" />}
      <div className="flex flex-col justify-center text-[11px] leading-tight">
        <div className="font-mono text-[12px] font-bold">{no}</div>
        <div>
          Order {order} · {style}
        </div>
        <div className="mt-1 text-base font-bold">
          {colour} / {size}
        </div>
        <div className="font-semibold">{component}</div>
        <div className="text-lg font-bold">{pcs} pcs</div>
      </div>
    </div>
  );
}

/** Bundle tickets with QR (A§11): order, colour, size, component, pieces. */
export function BundleTicketsPrint({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['print', 'lay', id], queryFn: () => api.get<CutLay>(`/cut-lays/${id}/print`) });
  if (!q.data) return <LoadingState />;
  const l = q.data;
  return (
    <PrintLayout size="LABEL" title={`Bundle tickets ${l.docNo ?? ''}`}>
      <div className="flex flex-col gap-2">
        {l.bundles.map((b) => (
          <BundleTicket key={b.id} no={b.bundleNo ?? '(draft)'} order={l.order.orderNo} style={l.order.styleNo} colour={b.colour} size={b.size} component={b.componentCode} pcs={b.pcs} />
        ))}
      </div>
    </PrintLayout>
  );
}

interface CartonPrintData {
  docNo: string | null;
  cartonSeq: number | null;
  docDate: string;
  grossKg: string | null;
  netKg: string | null;
  lengthCm: string | null;
  widthCm: string | null;
  heightCm: string | null;
  order: { orderNo: string; styleNo: string; buyerPoNo: string; buyer: { name: string } };
  lines: { colour: string; size: string; pcs: number }[];
  totalPcs: number;
}

/** Carton label with QR (A§11): buyer, PO, style, carton number, contents. */
export function CartonLabelPrint({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['print', 'carton', id], queryFn: () => api.get<CartonPrintData>(`/cartons/${id}/print`) });
  const qr = useQr(q.data?.docNo ?? id, 150);
  if (!q.data) return <LoadingState />;
  const c = q.data;
  return (
    <PrintLayout size="LABEL" title={`Carton ${c.docNo ?? ''}`}>
      <div className="flex h-[56mm] w-[96mm] gap-2 text-[11px] leading-tight">
        {qr ? <img src={qr} alt="QR" className="size-[34mm]" /> : null}
        <div className="flex flex-col justify-center">
          <div className="text-sm font-bold">{c.order.buyer.name}</div>
          <div>PO {c.order.buyerPoNo}</div>
          <div>
            Style {c.order.styleNo} · Order {c.order.orderNo}
          </div>
          <div className="mt-1 text-lg font-bold">CARTON {c.cartonSeq ?? '—'}</div>
          <div className="font-mono">{c.docNo}</div>
          <div>{c.lines.map((l) => `${l.colour}/${l.size} × ${l.pcs}`).join(', ')}</div>
          <div className="font-semibold">{c.totalPcs} pcs</div>
          <div>
            G {c.grossKg ? formatKg(c.grossKg) : '—'} / N {c.netKg ? formatKg(c.netKg) : '—'} kg
          </div>
        </div>
      </div>
    </PrintLayout>
  );
}

interface PlPrintData {
  docNo: string | null;
  docDate: string;
  order: { orderNo: string; styleNo: string; buyerPoNo: string; sizes: string[]; colours: string[]; buyer: { name: string; country: string | null } };
  cartons: { id: string; cartonSeq: number | null; docNo: string | null; grossKg: string | null; netKg: string | null; totalPcs: number; lines: { colour: string; size: string; pcs: number }[] }[];
  totals: { cartons: number; pcs: number; grossKg: string; netKg: string; byCell: Record<string, number> };
}

/** Export packing list (A4): carton-wise breakdown by colour and size (A§11). */
export function PackingListPrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useQuery({ queryKey: ['print', 'pl', id], queryFn: () => api.get<PlPrintData>(`/packing-lists/${id}/print`) });
  if (!q.data || company.isLoading) return <LoadingState />;
  const p = q.data;
  const sizes = p.order.sizes;
  return (
    <PrintLayout size="A4" landscape title={`Packing list ${p.docNo ?? ''}`}>
      <div className="flex items-start justify-between border-b-2 border-black pb-2">
        <CompanyBlock c={company.data} />
        <div className="text-right">
          <div className="text-base font-bold">PACKING LIST</div>
          <div className="font-mono">{p.docNo ?? 'DRAFT'}</div>
          <div>Date: {formatDate(p.docDate)}</div>
        </div>
      </div>
      <div className="my-2 grid grid-cols-3 gap-2">
        <div>
          <div className="font-semibold">Buyer</div>
          {p.order.buyer.name}
          {p.order.buyer.country ? `, ${p.order.buyer.country}` : ''}
        </div>
        <div>
          PO: {p.order.buyerPoNo}
          <br />
          Style: {p.order.styleNo}
        </div>
        <div>Order: {p.order.orderNo}</div>
      </div>
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr className="border-y border-black">
            <th className="text-left">Ctn #</th>
            <th className="text-left">Carton no.</th>
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
          {p.cartons.flatMap((c) => {
            const colours = [...new Set(c.lines.map((l) => l.colour))];
            return colours.map((col, i) => (
              <tr key={`${c.id}-${col}`} className="border-b border-slate-300">
                <td>{i === 0 ? c.cartonSeq : ''}</td>
                <td className="font-mono">{i === 0 ? c.docNo : ''}</td>
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
          {p.order.colours.map((col) => (
            <tr key={col}>
              <td colSpan={2} />
              <td className="font-semibold">{col}</td>
              {sizes.map((s) => (
                <td key={s} className="text-right font-semibold">
                  {p.totals.byCell[`${col}|${s}`] ?? ''}
                </td>
              ))}
              <td className="text-right font-semibold">{sizes.reduce((a, s) => a + (p.totals.byCell[`${col}|${s}`] ?? 0), 0) || ''}</td>
              <td colSpan={2} />
            </tr>
          ))}
          <tr className="border-y-2 border-black font-bold">
            <td colSpan={3 + sizes.length}>
              {p.totals.cartons} cartons
            </td>
            <td className="text-right">{formatQty(p.totals.pcs)}</td>
            <td className="text-right">{formatKg(p.totals.netKg)}</td>
            <td className="text-right">{formatKg(p.totals.grossKg)}</td>
          </tr>
        </tfoot>
      </table>
      <Signatures labels={['Packed by', 'Checked by', 'Authorised signatory']} />
    </PrintLayout>
  );
}

/** Panel D.C. to printer / embroiderer (job-work challan, A4). */
export function PanelDcPrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useQuery({ queryKey: ['print', 'panel', id], queryFn: () => api.get<PanelDc>(`/panel-dcs/${id}/print`) });
  if (!q.data || company.isLoading) return <LoadingState />;
  const d = q.data;
  return (
    <PrintLayout size="A4" title={`Panel D.C. ${d.docNo ?? ''}`}>
      <div className="flex items-start justify-between border-b-2 border-black pb-2">
        <CompanyBlock c={company.data} />
        <div className="text-right">
          <div className="text-base font-bold">DELIVERY CHALLAN — PANELS FOR {d.process.name.toUpperCase()}</div>
          <div className="text-[10px]">(Rule 55 of the CGST Rules, 2017 — goods sent for job work)</div>
          <div className="font-mono">{d.docNo ?? 'DRAFT'}</div>
          <div>Date: {formatDate(d.docDate)}</div>
        </div>
      </div>
      <div className="my-2 grid grid-cols-2 gap-2">
        <div>
          <div className="font-semibold">{d.vendor.name}</div>
          <div>{[d.vendor.addressLine1, d.vendor.city].filter(Boolean).join(', ')}</div>
          <div>GSTIN: {d.vendor.gstin ?? 'Unregistered'}</div>
        </div>
        <div>
          <div>Order: {d.order.orderNo} · {d.order.styleNo}</div>
          <div>Expected return: {formatDate(d.expectedReturnDate)}</div>
          <div>Vehicle: {d.vehicleNo ?? '—'}</div>
        </div>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-black">
            <th className="text-left">#</th>
            <th className="text-left">Bundle</th>
            <th className="text-left">Panel</th>
            <th className="text-left">Colour</th>
            <th className="text-left">Size</th>
            <th className="text-right">Pieces</th>
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l, i) => (
            <tr key={l.id} className="border-b border-slate-300">
              <td>{i + 1}</td>
              <td className="font-mono">{l.bundle.bundleNo}</td>
              <td>
                {l.panelItem.name} ({l.bundle.componentCode})
              </td>
              <td>{l.colour}</td>
              <td>{l.size}</td>
              <td className="text-right">{l.pcs}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-b border-black font-bold">
            <td colSpan={5}>{d.lines.length} bundles</td>
            <td className="text-right">{formatQty(d.totals.sent)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-2 text-[10px]">Cut panels sent for {d.process.name.toLowerCase()} on job-work basis, to be returned after processing. No sale is involved.</p>
      <Signatures labels={['Prepared by', "Receiver's signature", 'Authorised signatory']} />
    </PrintLayout>
  );
}
