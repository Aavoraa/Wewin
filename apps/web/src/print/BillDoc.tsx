import { type ReactNode } from 'react';
import { formatDate } from '@/lib/format';
import { CompanyBlock, PrintLayout, Signatures, VendorCertificate, useCompany } from './PrintLayout';

export interface BillDocParty {
  /** Heading above the name, e.g. "Vendor", "Buyer", "Issued to". */
  label: string;
  name: string;
  /** Address, GSTIN, contact… one line each; empty values are skipped. */
  lines?: (string | null | undefined)[];
  /** A vendor: its certificate no. and expiry print under the name (Q-074). */
  vendor?: { name: string; certificateNo?: string | null; certificateExpiry?: string | null };
}

export interface BillDocColumn {
  header: string;
  align?: 'left' | 'right';
}

/**
 * Bill-format page for documents without a dedicated layout: letterhead, title, number and date,
 * party, key details, one table of lines with a total row, remarks and signatures (A4).
 */
export function BillDoc(p: {
  title: string;
  subtitle?: string;
  docNo: string | null;
  docDate: string | null;
  status?: string;
  party?: BillDocParty;
  /** Label / value pairs shown beside the party. Empty values are skipped. */
  details?: [string, ReactNode][];
  columns: BillDocColumn[];
  rows: ReactNode[][];
  /** Total row cells, one per column (null = blank). */
  totals?: ReactNode[];
  /** Extra content under the table (a second table, notes). */
  after?: ReactNode;
  remarks?: string | null;
  signatures?: string[];
}) {
  const company = useCompany();
  const details = (p.details ?? []).filter(([, v]) => v !== null && v !== undefined && v !== '');
  const align = (c: BillDocColumn) => (c.align === 'right' ? 'text-right' : 'text-left');
  return (
    <PrintLayout title={`${p.title} ${p.docNo ?? ''}`}>
      <div className="flex items-start justify-between border-b-2 border-black pb-2">
        <CompanyBlock c={company.data} />
        <div className="text-right">
          <div className="text-base font-bold uppercase">{p.title}</div>
          {p.subtitle ? <div className="text-[10px]">{p.subtitle}</div> : null}
          <div className="mt-1 font-mono text-sm">{p.docNo ?? 'DRAFT'}</div>
          {p.docDate ? <div>Date: {formatDate(p.docDate)}</div> : null}
          {p.status === 'DRAFT' ? <div className="font-bold">DRAFT</div> : null}
          {p.status === 'CANCELLED' ? <div className="font-bold text-red-700">CANCELLED</div> : null}
        </div>
      </div>
      {p.party || details.length ? (
        <div className="my-2 grid grid-cols-2 gap-4 border-b border-black pb-2">
          <div>
            {p.party ? (
              <>
                <div className="text-[10px] font-semibold uppercase">{p.party.label}</div>
                <div className="font-semibold">{p.party.name}</div>
                {(p.party.lines ?? []).filter(Boolean).map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
                {p.party.vendor ? <VendorCertificate v={p.party.vendor} /> : null}
              </>
            ) : null}
          </div>
          <div className="grid grid-cols-[auto_1fr] content-start gap-x-3">
            {details.map(([k, v]) => (
              <div key={k} className="contents">
                <span>{k}</span>
                <b>{v}</b>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <table className="mt-2 w-full border-collapse">
        <thead>
          <tr className="border-y border-black">
            <th className="py-1 text-left">#</th>
            {p.columns.map((c) => (
              <th key={c.header} className={align(c)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-300 align-top">
              <td className="py-0.5">{i + 1}</td>
              {r.map((cell, ci) => (
                <td key={ci} className={align(p.columns[ci] ?? { header: '' })}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {p.rows.length === 0 ? (
            <tr>
              <td colSpan={p.columns.length + 1} className="py-2 text-center text-slate-500">
                No lines
              </td>
            </tr>
          ) : null}
        </tbody>
        {p.totals ? (
          <tfoot>
            <tr className="border-b border-black font-bold">
              <td className="py-1">Total</td>
              {p.totals.map((cell, ci) => (
                <td key={ci} className={align(p.columns[ci] ?? { header: '' })}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
      {p.after}
      {p.remarks ? <div className="mt-2">Remarks: {p.remarks}</div> : null}
      <Signatures labels={p.signatures ?? ['Prepared by', 'Checked by', 'Authorised signatory']} />
    </PrintLayout>
  );
}
