import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDate, formatQty } from '@/lib/format';
import { LoadingState } from '@/components/states';
import { type AccDoc } from '@/features/accessories/AccessoriesPages';
import { type SplDoc } from '@/features/accessories/SplPages';
import { ChallanCopies, CompanyBlock, PrintLayout, Signatures, VendorCertificate, useCompany } from './PrintLayout';

const TITLE: Record<string, string> = {
  RECEIPT: 'Accessories Purchase - GRN',
  RETURN: 'Accessories Purchase Return',
  REPLACEMENT: 'Accessories Purchase Replacement Inward',
  TRANSFER: 'Accessories Transfer Between Order',
  ISSUE: 'Accessories Consumption Issue',
};
const NO: Record<string, string> = { RECEIPT: 'GRN. No', RETURN: 'Return No', REPLACEMENT: 'Inward No', TRANSFER: 'Transfer No', ISSUE: 'Issue No' };

/** Accessories GRN / return / replacement / transfer, in the desktop GRN layout (A4). */
export function AccessoriesDocPrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useQuery({ queryKey: ['print', 'accessories', id], queryFn: () => api.get<AccDoc>(`/trims-docs/${id}/print`) });
  if (!q.data || company.isLoading) return <LoadingState />;
  const d = q.data;
  const transfer = d.type === 'TRANSFER';
  const v = d.vendor;
  // Goods going back to the supplier print as a three-copy delivery challan (Q-077).
  const challan = d.type === 'RETURN';
  const content = (
    <>
      {challan ? <div className="text-center text-base font-bold">DELIVERY CHALLAN</div> : null}
      <div className="mb-1 text-center text-sm font-bold underline">{TITLE[d.type]}</div>
      <div className="grid grid-cols-2 border border-dashed border-black">
        <div className="border-r border-dashed border-black p-2">
          <CompanyBlock c={company.data} />
        </div>
        <div className="p-2">
          {transfer ? (
            <>
              <div className="font-bold">From order: {d.order?.orderNo}</div>
              <div className="font-bold">To order: {d.toOrder?.orderNo}</div>
            </>
          ) : v ? (
            <>
              <div className="font-bold uppercase">{v.name}</div>
              <div className="text-[10px] leading-tight">{[v.addressLine1, v.addressLine2, v.city, v.pincode].filter(Boolean).join(', ')}</div>
              {v.gstin ? <div className="text-[10px]">GSTIN: {v.gstin}</div> : null}
              <VendorCertificate v={v} className="text-[10px]" />
            </>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-8 border-x border-b border-dashed border-black px-2 py-1">
        <span>
          <b>{NO[d.type]} :</b> {d.docNo ?? 'DRAFT'}
        </span>
        <span>
          <b>Date :</b> {formatDate(d.docDate)}
        </span>
        {d.supplierInvoiceNo ? <span>Inv.No : {d.supplierInvoiceNo}</span> : null}
        {d.dcNo ? (
          <span>
            D.C.No : {d.dcNo}
            {d.dcDate ? ` dt ${formatDate(d.dcDate)}` : ''}
          </span>
        ) : null}
        {d.returnDoc ? <span>Against return : {d.returnDoc.docNo}</span> : null}
        {d.status === 'CANCELLED' ? <span className="font-bold text-red-700">CANCELLED</span> : null}
      </div>
      <table className="w-full border-collapse border-x border-b border-dashed border-black">
        <thead>
          <tr className="border-b border-dashed border-black text-left">
            {!transfer ? <th className="px-1 py-1">P.O.No</th> : null}
            {!transfer ? <th>Our Order Ref</th> : null}
            <th>Acc.Description</th>
            <th>Colour</th>
            <th>Size</th>
            {d.type === 'RETURN' ? <th>Reason</th> : null}
            <th className="text-right">Qty</th>
            <th className="px-1">Uom</th>
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l) => (
            <tr key={l.id} className="align-top">
              {!transfer ? <td className="px-1 py-0.5">{l.poNo ?? ''}</td> : null}
              {!transfer ? <td>{l.orderNo ?? ''}</td> : null}
              <td>{l.item.name}</td>
              <td>{l.colour ?? ''}</td>
              <td>{l.size ?? ''}</td>
              {d.type === 'RETURN' ? <td>{l.reason ?? ''}</td> : null}
              <td className="text-right">{formatQty(l.qty)}</td>
              <td className="px-1">{l.item.unit}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-dashed border-black font-bold">
            <td colSpan={transfer ? 3 : d.type === 'RETURN' ? 6 : 5} />
            <td className="text-right">{formatQty(d.totals.qty)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <div className="border-x border-b border-dashed border-black p-2">
        <div className="text-right font-bold">For {company.data?.tradeName ?? company.data?.legalName}</div>
        <div className="mt-4">Remark {d.remarks ?? ''}</div>
      </div>
      <Signatures labels={['Received / checked by (Stores)', 'Authorised signatory']} />
    </>
  );
  return (
    <PrintLayout title={`${TITLE[d.type]} ${d.docNo ?? ''}`}>
      {challan ? <ChallanCopies>{() => content}</ChallanCopies> : content}
    </PrintLayout>
  );
}

/** Accessories SPL.Request (A4). */
export function SplRequestPrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useQuery({ queryKey: ['print', 'spl', id], queryFn: () => api.get<SplDoc>(`/spl-requests/${id}/print`) });
  if (!q.data || company.isLoading) return <LoadingState />;
  const d = q.data;
  return (
    <PrintLayout title={`SPL request ${d.docNo ?? ''}`}>
      <div className="flex items-start justify-between border-b border-black pb-2">
        <CompanyBlock c={company.data} />
        <div className="text-right">
          <div className="text-sm font-bold">ACCESSORIES SPL.REQUEST</div>
          <div className="font-mono">{d.docNo ?? 'DRAFT — not approved'}</div>
          <div>Date: {formatDate(d.docDate)}</div>
          {d.status === 'CANCELLED' ? <div className="font-bold text-red-700">CANCELLED</div> : null}
        </div>
      </div>
      <div className="my-2 grid grid-cols-2 gap-2">
        <div>
          Order: <b>{d.order.orderNo}</b> · {d.order.styleNo}
        </div>
        <div>Requested by: {d.requestedBy ?? '—'}</div>
        <div className="col-span-2">Reason: {d.reason}</div>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="py-1">Sl</th>
            <th>Accessories Description</th>
            <th>Colour</th>
            <th>Size</th>
            <th className="text-right">Qty</th>
            <th>Uom</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l, i) => (
            <tr key={l.id} className="border-b border-slate-300">
              <td className="py-0.5">{i + 1}</td>
              <td>{l.item.name}</td>
              <td>{l.colour ?? 'All'}</td>
              <td>{l.size ?? 'All'}</td>
              <td className="text-right">{formatQty(l.qty)}</td>
              <td>{l.item.unit}</td>
              <td>{l.reason ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.remarks ? <div className="mt-2">Remarks: {d.remarks}</div> : null}
      <Signatures labels={['Requested by', 'Merchandiser', 'Approved by (Management)']} />
    </PrintLayout>
  );
}
