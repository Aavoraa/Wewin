import { type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { D, QC_KIND_NAMES } from '@wewin/shared';
import { api } from '@/lib/api';
import { formatDateTimeIst, formatKg, formatQty } from '@/lib/format';
import { LoadingState } from '@/components/states';
import { type QcDoc, type QcLine, qcSummary } from '@/features/quality/QcPages';
import { type YarnProgram } from '@/features/jobwork/YarnProgramPages';
import { BillDoc, type BillDocColumn } from './BillDoc';

const RESULT: Record<string, string> = { PASS: 'Pass', HOLD: 'Hold', REJECT: 'Reject' };
const defectsText = (l: QcLine) => l.defects.map((x) => `${x.code} × ${x.count}`).join(', ');
/** Whole-piece / point counts (not kg or money). */
const sumInt = (vals: (number | null)[]) => vals.reduce<number>((a, v) => a + (v ?? 0), 0);

/** Quality check — fabric roll inspection, inline check or final inspection — in bill format (A4). */
export function QcPrint({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['print', 'qc', id], queryFn: () => api.get<QcDoc>(`/qc/${id}`) });
  if (!q.data) return <LoadingState />;
  const d = q.data;
  const fabric = d.kind === 'FABRIC_ROLL';
  const inline = d.kind === 'INLINE';

  let columns: BillDocColumn[];
  let rows: ReactNode[][];
  let totals: ReactNode[];
  if (fabric) {
    columns = [
      { header: 'Roll no.' },
      { header: 'Fabric / lot / colour' },
      { header: 'Kg', align: 'right' },
      { header: 'Result' },
      { header: 'GSM', align: 'right' },
      { header: 'Defect pts', align: 'right' },
      { header: 'Defects' },
      { header: 'Remarks' },
    ];
    rows = d.lines.map((l) => [
      <span className="font-mono">{l.roll?.rollNo ?? ''}</span>,
      l.roll ? [l.roll.item.name, l.roll.lot, l.roll.colour, l.roll.dia ? `Dia ${l.roll.dia}` : null].filter(Boolean).join(' · ') : '',
      l.roll ? formatKg(l.roll.kg) : '',
      l.result ? RESULT[l.result] : '',
      l.gsm ?? '',
      l.defectPoints ?? '',
      defectsText(l),
      l.remarks ?? '',
    ]);
    const kg = d.lines.reduce((a, l) => (l.roll ? a.plus(D(l.roll.kg)) : a), D(0));
    totals = [`${d.lines.length} rolls`, null, formatKg(kg.toFixed(3)), null, null, sumInt(d.lines.map((l) => l.defectPoints)) || '', null, null];
  } else if (inline) {
    columns = [
      { header: 'Bundle' },
      { header: 'Operator / machine' },
      { header: 'Colour' },
      { header: 'Size' },
      { header: 'Checked', align: 'right' },
      { header: 'Defective', align: 'right' },
      { header: 'Defects' },
      { header: 'Remarks' },
    ];
    rows = d.lines.map((l) => [
      l.bundle?.bundleNo ? <span className="font-mono">{l.bundle.bundleNo}</span> : '',
      l.operator ?? '',
      l.colour ?? '',
      l.size ?? '',
      l.checkedPcs !== null ? formatQty(l.checkedPcs) : '',
      l.rejectedPcs !== null ? formatQty(l.rejectedPcs) : '',
      defectsText(l),
      l.remarks ?? '',
    ]);
    totals = [null, null, null, null, formatQty(sumInt(d.lines.map((l) => l.checkedPcs))), formatQty(sumInt(d.lines.map((l) => l.rejectedPcs))), null, null];
  } else {
    columns = [
      { header: 'Colour' },
      { header: 'Size' },
      { header: 'Checked', align: 'right' },
      { header: 'Passed', align: 'right' },
      { header: 'Rejected', align: 'right' },
      { header: 'Defects' },
      { header: 'Remarks' },
    ];
    rows = d.lines.map((l) => [
      l.colour ?? '',
      l.size ?? '',
      l.checkedPcs !== null ? formatQty(l.checkedPcs) : '',
      l.passedPcs !== null ? formatQty(l.passedPcs) : '',
      l.rejectedPcs !== null ? formatQty(l.rejectedPcs) : '',
      defectsText(l),
      l.remarks ?? '',
    ]);
    totals = [
      null,
      null,
      formatQty(sumInt(d.lines.map((l) => l.checkedPcs))),
      formatQty(sumInt(d.lines.map((l) => l.passedPcs))),
      formatQty(sumInt(d.lines.map((l) => l.rejectedPcs))),
      null,
      null,
    ];
  }

  return (
    <BillDoc
      title={QC_KIND_NAMES[d.kind]}
      subtitle="Quality check"
      docNo={d.docNo}
      docDate={d.docDate}
      status={d.status}
      party={d.order ? { label: 'Buyer', name: d.order.buyer.name } : undefined}
      details={[
        ['Order', d.order ? `${d.order.orderNo} · ${d.order.styleNo}` : null],
        ['Sewing line', inline ? d.sewingLine : null],
        [inline ? 'Checker' : 'Inspector', d.inspector],
        ['Result', qcSummary(d)],
        ['Status', d.status === 'POSTED' ? 'Approved' : d.status === 'DRAFT' ? 'Awaiting approval' : d.status],
        ['Approved', d.status === 'POSTED' && d.postedAt ? formatDateTimeIst(d.postedAt) : null],
      ]}
      columns={columns}
      rows={rows}
      totals={totals}
      after={
        <>
          {d.approvalNote ? <div className="mt-2">Approval note: {d.approvalNote}</div> : null}
          {d.cancelReason ? <div className="mt-1 text-red-700">Cancelled: {d.cancelReason}</div> : null}
        </>
      }
      remarks={d.remarks}
      signatures={[inline ? 'Checker' : 'Inspector', 'QC in-charge', 'Approved by']}
    />
  );
}

/** Program Defined — a process programme (mix in, item out, allowed loss) in bill format (A4). */
export function YarnProgramPrint({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['print', 'yarn-program', id], queryFn: () => api.get<YarnProgram & { createdAt?: string }>(`/yarn-programs/${id}`) });
  if (!q.data) return <LoadingState />;
  const p = q.data;
  const mixTotal = p.inputs.reduce((a, l) => a.plus(D(l.mixPct)), D(0));
  const planTotal = p.inputs.reduce((a, l) => (l.planKg ? a.plus(D(l.planKg)) : a), D(0));
  const anyPlan = p.inputs.some((l) => l.planKg);
  return (
    <BillDoc
      title="PROGRAM DEFINED"
      subtitle={p.process.name}
      docNo={p.programNo}
      docDate={p.approvedAt ?? p.createdAt ?? null}
      status={p.status}
      details={[
        ['Order', `${p.order.orderNo} · ${p.order.styleNo}`],
        ['Process', p.process.name],
        ['Output', `${p.outputItem.name}${p.outputColour ? ` · ${p.outputColour}` : ''}`],
        ['Kg out wanted', p.requiredKg ? formatKg(p.requiredKg) : null],
        ['Allowed loss', `${D(p.allowedLossPct).toString()}%`],
        ['Kg to send', p.sendKg ? formatKg(p.sendKg) : null],
        ['Input cost ₹/kg', p.materialCostPerKg ? D(p.materialCostPerKg).toFixed(2) : null],
        ['Status', p.status === 'APPROVED' && p.approvedAt ? `Approved ${formatDateTimeIst(p.approvedAt)}` : p.status],
      ]}
      columns={[{ header: 'Input item' }, { header: 'Code' }, { header: 'Colour' }, { header: 'Mixing %', align: 'right' }, { header: 'Kg to send', align: 'right' }]}
      rows={p.inputs.map((l) => [l.item.name, l.item.code, l.colour ?? '', `${D(l.mixPct).toString()}%`, l.planKg ? formatKg(l.planKg) : ''])}
      totals={[null, null, null, `${mixTotal.toString()}%`, anyPlan ? formatKg(planTotal.toFixed(3)) : '']}
      remarks={p.remarks}
      signatures={['Prepared by', 'Production in-charge', 'Approved by']}
    />
  );
}
