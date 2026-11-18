import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatKg } from '@/lib/format';
import { LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

export interface OpenPoLine {
  poLineId: string;
  poNo: string | null;
  poDate: string;
  orderNo: string | null;
  itemId: string;
  item: { code: string; name: string };
  millName: string | null;
  counts: string | null;
  colour: string | null;
  bags: number | null;
  ordered: string;
  received: string;
  pending: string;
  ratePerKg: string;
  poKind?: 'YARN' | 'FABRIC';
  unit?: string;
  gsm?: number | null;
  dia?: string | null;
}

/**
 * GRN against PO (Q-080, Q-082): the supplier's approved yarn PO lines with kg still to come. Ticked lines are
 * added to the receipt with the pending kg and the PO rate per kg; the lot is typed in.
 */
export function LoadFromPo({
  endpoint,
  vendorId,
  orderId,
  already,
  onClose,
  onAdd,
}: {
  /** `/yarn-receipts/po-lines` or `/stock-docs/po-lines`. */
  endpoint: string;
  vendorId: string;
  orderId?: string;
  already: string[];
  onClose: () => void;
  onAdd: (lines: OpenPoLine[]) => void;
}) {
  const q = useQuery({ queryKey: ['po-lines', endpoint, vendorId, orderId], queryFn: () => api.get<OpenPoLine[]>(endpoint, { vendorId, orderId }) });
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const rows = (q.data ?? []).filter((l) => !already.includes(l.poLineId));
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent title="Load from PO" className="max-w-4xl">
        {q.isLoading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No approved PO of this supplier has anything still to receive{orderId ? ' for this order' : ''}.</div>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table className="whitespace-nowrap">
              <THead>
                <TR>
                  <TH className="w-8" />
                  <TH>PO</TH>
                  <TH>Date</TH>
                  <TH>Order</TH>
                  <TH>Item</TH>
                  <TH>Mill / counts / GSM / colour</TH>
                  <TH className="text-right">Ordered</TH>
                  <TH className="text-right">Received</TH>
                  <TH className="text-right">Pending</TH>
                  <TH className="text-right">PO rate ₹</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((l) => (
                  <TR key={l.poLineId}>
                    <TD>
                      <Checkbox aria-label={`Load ${l.poNo ?? ''} ${l.item.name}`} checked={!!ticked[l.poLineId]} onChange={(e) => setTicked((t) => ({ ...t, [l.poLineId]: e.target.checked }))} />
                    </TD>
                    <TD className="font-mono">{l.poNo}</TD>
                    <TD>{l.poDate}</TD>
                    <TD>{l.orderNo ?? '—'}</TD>
                    <TD>{l.item.name}</TD>
                    <TD>{[l.millName, l.counts, l.gsm ? `${l.gsm} GSM` : null, l.dia, l.colour].filter(Boolean).join(' · ') || '—'}</TD>
                    <TD className="text-right tabular-nums">{formatKg(l.ordered)}</TD>
                    <TD className="text-right tabular-nums">{formatKg(l.received)}</TD>
                    <TD className="text-right font-semibold tabular-nums">{formatKg(l.pending)}</TD>
                    <TD className="text-right tabular-nums">{l.ratePerKg}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button disabled={!rows.some((l) => ticked[l.poLineId])} onClick={() => onAdd(rows.filter((l) => ticked[l.poLineId]))}>
            Add ticked lines
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
