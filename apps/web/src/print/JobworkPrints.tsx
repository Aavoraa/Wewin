import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { D } from '@wewin/shared';
import { api } from '@/lib/api';
import { formatDate, formatDateTimeIst, formatInr, formatKg, formatPct } from '@/lib/format';
import { useQr } from '@/lib/qr';
import { LoadingState } from '@/components/states';
import { type InwardDc, type OutwardDc } from '@/features/jobwork/types';
import { CompanyBlock, PrintLayout, Signatures, useCompany } from './PrintLayout';

const COPIES = ['ORIGINAL FOR JOB WORKER', 'DUPLICATE FOR TRANSPORTER', 'TRIPLICATE FOR SENDER'] as const;

/**
 * Delivery challan for job work (Rule 55, CGST Rules): GSTIN of both parties, HSN, quantity, value,
 * purpose "for job work", three copies (A§11). Printed A4.
 */
export function OutwardDcPrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useQuery({ queryKey: ['print', 'outward', id], queryFn: () => api.get<OutwardDc>(`/outward-dcs/${id}/print`) });
  if (!q.data || company.isLoading) return <LoadingState />;
  const o = q.data;
  const v = o.vendor;
  return (
    <PrintLayout size="A4" title={`D.C. ${o.docNo ?? ''}`}>
      {COPIES.map((copy, ci) => (
        <Fragment key={copy}>
          <div className={ci < COPIES.length - 1 ? 'print-break mb-6' : ''}>
            <div className="mb-1 text-right text-[10px] font-semibold">{copy}</div>
            <div className="flex items-start justify-between border-b-2 border-black pb-2">
              <CompanyBlock c={company.data} />
              <div className="text-right">
                <div className="text-base font-bold">DELIVERY CHALLAN</div>
                <div className="text-[10px]">(Rule 55 of the CGST Rules, 2017 — goods sent for job work)</div>
                <div className="mt-1 font-mono text-sm">{o.docNo ?? 'DRAFT'}</div>
                <div>Date: {formatDate(o.docDate)}</div>
                {o.status === 'CANCELLED' ? <div className="font-bold text-red-700">CANCELLED</div> : null}
                {o.approvalStatus === 'PENDING' ? <div className="font-bold text-amber-700">NOT APPROVED</div> : null}
              </div>
            </div>
            <div className="my-2 grid grid-cols-2 gap-3 border-b border-black pb-2">
              <div>
                <div className="font-semibold">Consignee (job worker)</div>
                <div className="font-semibold">{v.name}</div>
                <div>{[v.addressLine1, v.addressLine2, v.city, v.pincode].filter(Boolean).join(', ')}</div>
                <div>
                  State: {v.state ?? '—'} {v.stateCode ? `(${v.stateCode})` : ''}
                </div>
                <div className="font-semibold">GSTIN: {v.gstin ?? 'Unregistered'}</div>
              </div>
              <div>
                <div>Purpose: {o.purpose}</div>
                <div>Process: {o.process.name}</div>
                <div>Order: {o.order.orderNo} · Program {o.programProcess.program.programNo}</div>
                <div>Dispatched from: {o.fromLocation.name}</div>
                <div>Vehicle no.: {o.vehicleNo ?? '—'}</div>
                <div>Expected return: {formatDate(o.expectedReturnDate)}</div>
              </div>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-y border-black">
                  <th className="py-1 text-left">#</th>
                  <th className="text-left">Description of goods</th>
                  <th className="text-left">HSN</th>
                  <th className="text-left">Lot / roll</th>
                  <th className="text-right">Rolls</th>
                  <th className="text-right">Qty (kg)</th>
                  <th className="text-right">Rate ₹/kg</th>
                  <th className="text-right">Value ₹</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.id} className="border-b border-slate-300">
                    <td className="py-0.5">{l.lineNo}</td>
                    <td>
                      {l.item.name}
                      {l.colour ? ` · ${l.colour}` : ''}
                    </td>
                    <td>{l.item.hsnCode ?? ''}</td>
                    <td>{[l.lot, l.roll?.rollNo].filter(Boolean).join(' / ')}</td>
                    <td className="text-right">{l.rolls ?? ''}</td>
                    <td className="text-right">{formatKg(l.qtyKg)}</td>
                    <td className="text-right">{l.valuePerKg ?? ''}</td>
                    <td className="text-right">{l.value ? formatInr(l.value, { symbol: false }) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-b border-black font-bold">
                  <td colSpan={4} className="py-1">
                    Total
                  </td>
                  <td className="text-right">{o.totals.rolls || ''}</td>
                  <td className="text-right">{formatKg(o.totals.sentKg)}</td>
                  <td />
                  <td className="text-right">{formatInr(o.totals.value)}</td>
                </tr>
              </tfoot>
            </table>
            <p className="mt-2 text-[10px]">
              Goods are sent for job work and are to be returned after processing. No sale is involved. Value stated for the purpose of the
              delivery challan only.
            </p>
            {o.remarks ? <div className="mt-1">Remarks: {o.remarks}</div> : null}
            <Signatures
              labels={['Prepared by', "Receiver's signature & seal", `For ${company.data?.tradeName ?? company.data?.legalName ?? ''} — Authorised signatory`]}
              signed={[null, null, o.approvedBy ? `Approved: ${o.approvedBy.fullName}\n${formatDateTimeIst(o.approvedAt)}` : null]}
            />
          </div>
        </Fragment>
      ))}
    </PrintLayout>
  );
}

/** Inward D.C. / GRN (A5): rolls, weights, GSM / dia and the loss % of each linked outward (A§11). */
export function InwardDcPrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useQuery({ queryKey: ['print', 'inward', id], queryFn: () => api.get<InwardDc>(`/inward-dcs/${id}/print`) });
  const outwards = useQuery({
    queryKey: ['print', 'inward-outwards', id],
    enabled: !!q.data,
    queryFn: async () => Promise.all((q.data?.links ?? []).map((k) => api.get<OutwardDc>(`/outward-dcs/${k.outwardDcId}`))),
  });
  if (!q.data || company.isLoading || outwards.isLoading) return <LoadingState />;
  const i = q.data;
  return (
    <PrintLayout size="A5" title={`GRN ${i.docNo ?? ''}`}>
      <div className="flex items-start justify-between border-b border-black pb-1">
        <CompanyBlock c={company.data} />
        <div className="text-right">
          <div className="text-sm font-bold">INWARD D.C. / GRN</div>
          <div className="font-mono">{i.docNo ?? 'DRAFT'}</div>
          <div>Date: {formatDate(i.docDate)}</div>
        </div>
      </div>
      <div className="my-1 grid grid-cols-2 gap-2">
        <div>
          <div className="font-semibold">{i.vendor.name}</div>
          <div>GSTIN: {i.vendor.gstin ?? '—'}</div>
        </div>
        <div>
          <div>
            Vendor D.C.: {i.vendorDcNo ?? '—'} {i.vendorDcDate ? `dt ${formatDate(i.vendorDcDate)}` : ''}
          </div>
          <div>Received at: {i.toLocation.name}</div>
        </div>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-black">
            <th className="text-left">Roll</th>
            <th className="text-left">Fabric</th>
            <th className="text-left">Lot</th>
            <th className="text-left">Colour</th>
            <th className="text-right">GSM</th>
            <th className="text-left">Dia</th>
            <th className="text-right">Kg</th>
          </tr>
        </thead>
        <tbody>
          {i.lines.map((l) => (
            <tr key={l.id} className="border-b border-slate-300">
              <td className="font-mono">{l.rollNo}</td>
              <td>{l.item.name}</td>
              <td>{l.lot}</td>
              <td>{l.colour}</td>
              <td className="text-right">{l.gsm ?? ''}</td>
              <td>{l.dia ?? ''}</td>
              <td className="text-right">{formatKg(l.kg)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-b border-black font-bold">
            <td colSpan={6}>{i.totals.rolls} rolls</td>
            <td className="text-right">{formatKg(i.totals.kg)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="mt-2 font-semibold">Against outward D.C.s</div>
      <table className="w-full">
        <tbody>
          {(outwards.data ?? []).map((o) => {
            const link = i.links.find((k) => k.outwardDcId === o.id)!;
            return (
              <tr key={o.id} className="border-b border-slate-300">
                <td className="font-mono">{o.docNo}</td>
                <td>{o.process.name}</td>
                <td className="text-right">this: {formatKg(link.receivedKg)} kg</td>
                <td className="text-right">
                  sent {formatKg(o.loss.sentKg)} · recd {formatKg(o.loss.receivedKg)}
                </td>
                <td className="text-right font-semibold">
                  loss {formatPct(o.loss.lossPct)} {o.loss.final ? '(final)' : '(running)'} / allowed {formatPct(o.loss.allowedPct)}
                  {D(o.loss.excessKg).gt(0) ? ` · excess ${formatKg(o.loss.excessKg)} kg` : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Signatures labels={['Received by (Stores)', 'Quality check', 'Authorised']} />
    </PrintLayout>
  );
}

function RollLabel({ rollNo, item, lot, colour, kg, gsm, dia }: { rollNo: string; item: string; lot: string; colour: string; kg: string; gsm: number | null; dia: string | null }) {
  const qr = useQr(rollNo, 140);
  return (
    <div className="print-break flex h-[56mm] w-[96mm] gap-2 border border-dashed border-slate-300 p-1 print:border-0">
      {qr ? <img src={qr} alt={`QR ${rollNo}`} className="size-[34mm]" /> : <div className="size-[34mm]" />}
      <div className="flex flex-col justify-center text-[11px] leading-tight">
        <div className="font-mono text-sm font-bold">{rollNo}</div>
        <div>{item}</div>
        <div>Lot: {lot || '—'}</div>
        <div>Colour: {colour || '—'}</div>
        <div>
          GSM {gsm ?? '—'} · Dia {dia ?? '—'}
        </div>
        <div className="text-base font-bold">{formatKg(kg)} kg</div>
      </div>
    </div>
  );
}

/** Roll labels with QR (label roll, A§11) for every roll of an inward D.C. */
export function RollLabelsPrint({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['print', 'inward', id], queryFn: () => api.get<InwardDc>(`/inward-dcs/${id}/print`) });
  if (!q.data) return <LoadingState />;
  return (
    <PrintLayout size="LABEL" title={`Roll labels ${q.data.docNo ?? ''}`}>
      <div className="flex flex-col gap-2">
        {q.data.lines.map((l) => (
          <RollLabel key={l.id} rollNo={l.rollNo} item={l.item.name} lot={l.lot} colour={l.colour} kg={l.kg} gsm={l.gsm} dia={l.dia} />
        ))}
      </div>
    </PrintLayout>
  );
}
