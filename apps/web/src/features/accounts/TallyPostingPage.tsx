import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Send } from 'lucide-react';
import { toast } from 'sonner';
import { D } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTimeIst, formatInr } from '@/lib/format';
import { EmptyState, LoadingState, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

interface TallyNote {
  id: string;
  docNo: string | null;
  docDate: string;
  status: string;
  isAuto: boolean;
  vendor: { id: string; name: string; tallyLedger: string };
  bill: { id: string; docNo: string | null; kind: string; vendorInvoiceNo: string } | null;
  taxableAmount: string;
  gstAmount: string;
  totalAmount: string;
  cancelReason: string | null;
  tallyExportedAt: string | null;
  tallyCancelExportedAt: string | null;
  action: 'CREATE' | 'CANCEL';
}

function download(fileName: string, xml: string) {
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Debit Note Posting to Accounts (Q-084): posted debit notes not yet in Tally (and cancellations of
 * ones already sent) are ticked and downloaded as a Tally XML import file, which marks them posted.
 */
export function TallyPostingPage() {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<'PENDING' | 'POSTED'>('PENDING');
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['tally', 'debit-notes', queue], queryFn: () => api.get<TallyNote[]>('/tally/debit-notes', { queue }) });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const picked = rows.filter((r) => ticked[r.id]);
  const total = picked.filter((r) => r.action === 'CREATE').reduce((a, r) => a.plus(D(r.totalAmount)), D(0));
  const all = rows.length > 0 && rows.every((r) => ticked[r.id]);

  async function run(mark: boolean) {
    if (!picked.length) return;
    setBusy(true);
    try {
      const r = await api.post<{ fileName: string; xml: string; count: number; total: string }>('/tally/debit-notes/export', { ids: picked.map((p) => p.id), mark });
      download(r.fileName, r.xml);
      toast.success(mark ? `${r.count} debit note(s) posted to Tally — import ${r.fileName} in Tally` : `${r.fileName} downloaded again`);
      setTicked({});
      void qc.invalidateQueries({ queryKey: ['tally'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Debit Note Posting to Accounts"
        description="Send Wewin debit notes to Tally: tick them, download the Tally import file, then import it in Tally. Cancelled notes that were already sent go across as cancellations."
        actions={
          queue === 'PENDING' ? (
            <Button onClick={() => void run(true)} disabled={!picked.length || busy} loading={busy}>
              <Send /> Post to Tally ({picked.length})
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void run(false)} disabled={!picked.length || busy} loading={busy}>
              <Download /> Download again ({picked.length})
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="grid gap-1 text-sm">
          <div className="font-medium">Importing in Tally Prime</div>
          <div className="text-muted-foreground">
            Gateway of Tally › Import › Transactions › choose the downloaded file. The vendor ledgers (Tally ledger name on each vendor, else its name), the job-work / purchase / GST
            ledgers and the voucher type must exist in Tally with the names set in Settings › Business settings (tally.*).
          </div>
        </CardContent>
      </Card>
      <div className="flex items-center gap-2">
        <Select
          className="h-9 w-56"
          value={queue}
          onChange={(e) => {
            setQueue(e.target.value as typeof queue);
            setTicked({});
          }}
          aria-label="Queue"
        >
          <option value="PENDING">To post to Tally</option>
          <option value="POSTED">Already posted</option>
        </Select>
        {picked.length && queue === 'PENDING' ? <span className="text-sm text-muted-foreground">Ticked total {formatInr(total.toFixed(2), { symbol: true })}</span> : null}
      </div>
      {q.isLoading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState title={queue === 'PENDING' ? 'Nothing to post' : 'Nothing posted yet'} hint={queue === 'PENDING' ? 'Every posted debit note is already in Tally.' : 'Debit notes appear here once posted to Tally.'} />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table className="whitespace-nowrap">
              <THead>
                <TR>
                  <TH className="w-8">
                    <Checkbox aria-label="Tick all" checked={all} onChange={(e) => setTicked(e.target.checked ? Object.fromEntries(rows.map((r) => [r.id, true])) : {})} />
                  </TH>
                  <TH>Debit note</TH>
                  <TH>Date</TH>
                  <TH>Vendor</TH>
                  <TH>Tally ledger</TH>
                  <TH>Against bill / invoice</TH>
                  <TH className="text-right">Taxable ₹</TH>
                  <TH className="text-right">GST ₹</TH>
                  <TH className="text-right">Total ₹</TH>
                  <TH>{queue === 'PENDING' ? 'Goes to Tally as' : 'Posted'}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <Checkbox aria-label={`Tick ${r.docNo ?? ''}`} checked={!!ticked[r.id]} onChange={(e) => setTicked((t) => ({ ...t, [r.id]: e.target.checked }))} />
                    </TD>
                    <TD className="font-mono">
                      <Link to={`/debit-notes/${r.id}`} className="hover:underline">
                        {r.docNo}
                      </Link>{' '}
                      {r.isAuto ? <Badge variant="info">auto</Badge> : null}
                    </TD>
                    <TD>{formatDate(r.docDate)}</TD>
                    <TD>{r.vendor.name}</TD>
                    <TD>{r.vendor.tallyLedger}</TD>
                    <TD>{r.bill ? `${r.bill.docNo ?? ''} · ${r.bill.vendorInvoiceNo}` : 'On account'}</TD>
                    <TD className="text-right tabular-nums">{formatInr(r.taxableAmount)}</TD>
                    <TD className="text-right tabular-nums">{formatInr(r.gstAmount)}</TD>
                    <TD className="text-right font-semibold tabular-nums">{formatInr(r.totalAmount)}</TD>
                    <TD>
                      {queue === 'PENDING' ? (
                        r.action === 'CANCEL' ? (
                          <Badge variant="danger">Cancellation</Badge>
                        ) : (
                          <Badge variant="success">New voucher</Badge>
                        )
                      ) : (
                        <span className="text-xs">
                          {r.tallyExportedAt ? formatDateTimeIst(r.tallyExportedAt) : '—'}
                          {r.tallyCancelExportedAt ? ` · cancelled ${formatDateTimeIst(r.tallyCancelExportedAt)}` : ''}
                        </span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
