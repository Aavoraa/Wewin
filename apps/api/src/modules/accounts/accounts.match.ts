/**
 * 3-way bill matching (A§7.3): inward D.C. (billable qty) × rate contract effective on the D.C.
 * date × vendor invoice. Pure functions; the core formulas live in @wewin/shared.
 */
import { D, type RateContractLike, type ToleranceMode, effectiveRate, expectedAmount, matchBill } from '@wewin/shared';

export { expectedAmount, matchBill };
export type { ToleranceMode };

export interface BillableDoc {
  sourceType: 'INWARD_DC' | 'PANEL_IN';
  sourceId: string;
  docNo: string;
  docDate: string;
  processId: string;
  itemId: string | null;
  orderId: string | null;
  qty: string;
  unit: 'KG' | 'PCS';
}

export interface PricedLine extends BillableDoc {
  rate: string | null;
  rateContractId: string | null;
  expected: string | null;
}

/** Price each billable document with the contract effective on its date for its process. */
export function priceLines<C extends RateContractLike & { processId: string }>(docs: BillableDoc[], contracts: C[]): PricedLine[] {
  return docs.map((d) => {
    const c = effectiveRate(
      contracts.filter((x) => x.processId === d.processId),
      { date: d.docDate, itemId: d.itemId, orderId: d.orderId },
    );
    const rate = c ? D(c.rate).toString() : null;
    return { ...d, rate, rateContractId: c?.id ?? null, expected: rate === null ? null : expectedAmount(d.qty, rate) };
  });
}

/** Line-level discrepancy (invoiced − expected) when the accountant entered the invoice amount per D.C. */
export function lineVariance(expected: string | null, invoiced: string | null): string | null {
  if (expected === null || invoiced === null) return null;
  return D(invoiced).minus(D(expected)).toFixed(2);
}
