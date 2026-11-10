import { Link } from 'react-router';
import { CheckCircle2, Plus } from 'lucide-react';
import { type ReviewPatch } from '@wewin/shared';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { EntityPicker } from '@/components/EntityPicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { pickers } from '../orders/api';
import { type ScanDetail } from './types';

const DETAILS: [string, string][] = [
  ['fabricDescription', 'Fabric description'],
  ['fabricType', 'Fabric type'],
  ['greyGsm', 'Grey GSM'],
  ['finalGsm', 'Final GSM'],
  ['gauge', 'GG'],
  ['loopLength', 'LL'],
  ['uom', 'Uom'],
  ['mtrToKg', 'Mtr to kg'],
  ['collarCuffReqd', 'Coll / cuff reqd'],
  ['tubSingle', 'Tub / single'],
  ['processTemplate', 'Process template'],
];
const SIZE_ROWS: [string, string][] = [
  ['length', 'Length'],
  ['lengthAllowance', 'All.'],
  ['width', 'Width'],
  ['widthAllowance', 'All.'],
  ['pcsWeight', 'Pcs. wgt'],
  ['actDia', 'Act. dia'],
  ['actPcsWeight', 'Act. pcs wgt'],
  ['knitDia', 'Knit dia'],
  ['finishDia', 'Finish dia'],
];

/**
 * A desktop Programme Entry screenshot (Q-068): what was read, the Wewin order it belongs to (suggested
 * from the desktop order ref, confirmed here), and one "Create" per portion. The highlighted portion
 * carries the details; the others open their own pre-filled programme forms.
 */
export function ProgrammeScanBox({ scan, editable, save }: { scan: ScanDetail; editable: boolean; save: (extra: Partial<Omit<ReviewPatch, 'version'>>) => Promise<unknown> }) {
  const { can } = useAuth();
  const p = scan.review?.programme;
  const om = scan.review?.programmeOrder;
  if (!p || !om) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground">Save to read this file as a programme screenshot.</CardContent>
      </Card>
    );
  }
  const confirmed = om.state === 'CONFIRMED' && !!om.id;
  const chosen = om.candidates.find((c) => c.id === om.id);
  const canCreate = can('programs.edit');
  const selected = p.portions.find((x) => x.selected) ?? p.portions[0];
  const otherHref = (portion: string, colour: string) =>
    `/programs/new?orderId=${om.id}&portion=${encodeURIComponent(portion)}${colour ? `&colour=${encodeURIComponent(colour)}` : ''}`;
  const val = (k: string) => (p as unknown as Record<string, string>)[k] || '—';

  return (
    <>
      <Card className={cn(!confirmed && 'ring-1 ring-red-200 dark:ring-red-900')}>
        <CardHeader>
          <CardTitle className="text-sm">Order</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <div className="text-xs text-muted-foreground">
            Order ref on the screenshot: <span className="font-mono text-foreground">{p.orderRef || '—'}</span> · colour {p.colour || '—'} · order qty {p.orderQty || '—'}
          </div>
          {om.candidates.length ? (
            <div className="grid gap-1">
              {om.candidates.map((c) => (
                <label key={c.id} className={cn('flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5', om.id === c.id && confirmed && 'border-blue-600 bg-blue-50 dark:bg-blue-950')}>
                  <input type="radio" name="programme-order" disabled={!editable} checked={confirmed && om.id === c.id} onChange={() => void save({ programmeOrderId: c.id }).catch(() => undefined)} />
                  <span className="font-mono">{c.code}</span>
                  <span className="truncate text-muted-foreground">{c.name}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">{c.reason}</span>
                </label>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No Wewin order matched the order ref — pick it below.</div>
          )}
          <EntityPicker
            endpoint="/orders"
            query={{ active: 'true' }}
            map={pickers.order}
            value={confirmed ? om.id : null}
            valueLabel={chosen ? `${chosen.code} · ${chosen.name}` : undefined}
            placeholder="Pick another order…"
            disabled={!editable}
            onChange={(o) => void save({ programmeOrderId: o?.id ?? null }).catch(() => undefined)}
          />
          {confirmed ? (
            <div className="flex items-center gap-1 text-xs text-blue-800">
              <CheckCircle2 className="size-4" /> Order confirmed
            </div>
          ) : (
            <div className="text-xs text-destructive">Confirm the order before creating the programme.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Portions · {p.portions.length} read</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-1.5">Portion</th>
                <th>Fab. colour</th>
                <th>Print colour</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {p.portions.map((x) => (
                <tr key={x.portion} className={cn('border-b', x === selected && 'bg-blue-50 dark:bg-blue-950')}>
                  <td className="px-3 py-1.5 font-medium">{x.portion}</td>
                  <td>{x.fabColour}</td>
                  <td>{x.printColour}</td>
                  <td className="pr-3 text-right">
                    {x === selected ? (
                      <Badge variant="success">Details below · “Create programme”</Badge>
                    ) : scan.status === 'APPLIED' || confirmed ? (
                      canCreate ? (
                        <Button size="sm" variant="outline" asChild>
                          <Link to={otherHref(x.portion, x.fabColour)}>
                            <Plus /> Create
                          </Link>
                        </Button>
                      ) : null
                    ) : (
                      <span className="text-[11px] text-muted-foreground">confirm the order first</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-muted-foreground">
            The screenshot shows the details of the highlighted portion only. The other portions open a programme form with the order, colour and portion filled in.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Details read for {selected?.portion ?? 'the portion'}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-3">
            {DETAILS.map(([k, label]) => (
              <div key={k}>
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <div>{val(k)}</div>
              </div>
            ))}
            <div>
              <div className="text-[11px] text-muted-foreground">Measurement</div>
              <div>
                {p.withMeasurement ? 'With' : 'Without'} · {p.measureUnit || 'CM'}
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MiniTable title="Yarn details" head={['Yarn counts', 'Colour', 'Cons. %']} rows={p.yarns.map((y) => [y.counts, y.colour, y.consPct])} />
            <MiniTable title="Process template" head={['Process', 'Loss %']} rows={p.processes.map((x) => [x.name, x.lossPct])} />
          </div>
          {p.sizes.length ? (
            <div className="overflow-x-auto">
              <div className="mb-1 text-xs font-medium">Size-wise measurements</div>
              <table className="text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th />
                    {p.sizes.map((s) => (
                      <th key={s.size} className="px-2 text-right">
                        {s.size}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SIZE_ROWS.map(([k, label], i) => (
                    <tr key={`${k}${i}`}>
                      <td className="whitespace-nowrap pr-2 text-muted-foreground">{label}</td>
                      {p.sizes.map((s) => (
                        <td key={s.size} className="px-2 text-right font-mono">
                          {(s as unknown as Record<string, string>)[k] || ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            “Create programme” opens the programme form with all of this filled in. Check it there, pick the input and output items of each process, and save — the screenshot is then marked as used.
          </p>
        </CardContent>
      </Card>
    </>
  );
}

function MiniTable({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium">{title}</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {head.map((h) => (
              <th key={h} className="py-0.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i} className="border-b">
                {r.map((c, j) => (
                  <td key={j} className="py-0.5">
                    {c || ''}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={head.length} className="py-1 text-muted-foreground">
                Not read
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
