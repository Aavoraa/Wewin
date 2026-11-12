import { Fragment, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';

export interface CompanyHeader {
  legalName: string;
  tradeName?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  gstin: string;
  phone?: string | null;
  email?: string | null;
  pan?: string | null;
  iec?: string | null;
  isPlaceholder?: boolean;
}

export function useCompany() {
  return useQuery({ queryKey: ['print', 'company'], queryFn: () => api.get<CompanyHeader>('/settings/company'), staleTime: 300_000 });
}

/** Company letterhead from company_settings (A§11). */
export function CompanyBlock({ c }: { c?: CompanyHeader }) {
  if (!c) return null;
  return (
    <div>
      <img src="/brand/wewin-logo.png" alt="Wewin Knit Fashions" className="mb-1 h-8 w-auto" />
      <div className="text-base font-bold uppercase">{c.tradeName ?? c.legalName}</div>
      {c.tradeName ? <div className="text-[10px]">{c.legalName}</div> : null}
      <div className="text-[10px] leading-tight">
        {c.addressLine1}
        {c.addressLine2 ? `, ${c.addressLine2}` : ''}, {c.city} – {c.pincode}, {c.state} (State code {c.stateCode})
      </div>
      <div className="text-[10px] font-semibold">GSTIN: {c.gstin}</div>
      {c.phone || c.email ? <div className="text-[10px]">{[c.phone, c.email].filter(Boolean).join(' · ')}</div> : null}
    </div>
  );
}

/**
 * Base print page: screen preview with a Print button; @media print hides chrome.
 * `size` sets the page box (A4 / A5 / label).
 */
export function PrintLayout({
  size = 'A4',
  landscape,
  children,
  title,
}: {
  size?: 'A4' | 'A5' | 'LABEL';
  landscape?: boolean;
  children: ReactNode;
  title: string;
}) {
  const pageCss =
    size === 'LABEL' ? '@page { size: 100mm 60mm; margin: 2mm; }' : `@page { size: ${size}${landscape ? ' landscape' : ''}; margin: 8mm; }`;
  return (
    <div className="min-h-full bg-slate-200 py-6 print:bg-white print:py-0">
      <style>{pageCss}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-2">
        <span className="text-sm text-slate-600">{title} — print preview</span>
        <Button onClick={() => window.print()} autoFocus>
          <Printer /> Print
        </Button>
      </div>
      <div
        className={cn(
          'print-page mx-auto bg-white p-[8mm] text-[11px] text-black shadow-lg',
          size === 'A4' ? 'print-a4' : size === 'A5' ? 'print-a5' : 'print-label p-[2mm]',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Vendor certificate under the vendor's name on every print (Q-074). Accepts a full timestamp or a
 * YYYY-MM-DD date; shows a dash while the vendor has none.
 */
export function VendorCertificate({ v, className }: { v: { name: string; certificateNo?: string | null; certificateExpiry?: string | null }; className?: string }) {
  const expiry = v.certificateExpiry ? v.certificateExpiry.slice(0, 10) : null;
  return (
    <div className={className}>
      <div>Certificate no.: {v.certificateNo ?? '—'}</div>
      <div>Certificate valid till: {expiry ? formatDate(expiry) : '—'}</div>
    </div>
  );
}

/** Copy labels of a delivery challan (Rule 55): consignee, transporter, sender. */
export const CHALLAN_COPIES = ['ORIGINAL FOR CONSIGNEE', 'DUPLICATE FOR TRANSPORTER', 'TRIPLICATE FOR SENDER'] as const;
export const JOB_WORK_CHALLAN_COPIES = ['ORIGINAL FOR JOB WORKER', 'DUPLICATE FOR TRANSPORTER', 'TRIPLICATE FOR SENDER'] as const;

/** Prints `children` once per copy, each on its own page with the copy name at the top right. */
export function ChallanCopies({ copies = CHALLAN_COPIES, children }: { copies?: readonly string[]; children: (copy: string) => ReactNode }) {
  return (
    <>
      {copies.map((copy, ci) => (
        <Fragment key={copy}>
          <div className={ci < copies.length - 1 ? 'print-break mb-6' : ''}>
            <div className="mb-1 text-right text-[10px] font-semibold">{copy}</div>
            {children(copy)}
          </div>
        </Fragment>
      ))}
    </>
  );
}

/** Signature block used on bills, debit notes and vouchers (A§11). */
export function Signatures({ labels, signed = [] }: { labels: string[]; /** Text printed above each line (e.g. who approved), by position. */ signed?: (string | null | undefined)[] }) {
  return (
    <div className="mt-10 grid gap-6" style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)` }}>
      {labels.map((l, i) => (
        <div key={l} className="flex flex-col justify-end text-center text-[10px]">
          {signed[i] ? <div className="mb-0.5 whitespace-pre-line text-[10px] font-semibold">{signed[i]}</div> : null}
          <div className="border-t border-black pt-1">{l}</div>
        </div>
      ))}
    </div>
  );
}
