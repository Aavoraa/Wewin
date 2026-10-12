import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { D } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatInr, formatKg, formatQty } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { LineGrid, newKey, type GridRow } from '@/components/LineGrid';
import { EntityPicker } from '@/components/EntityPicker';
import { StatusBadge } from '@/components/StatusBadge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState, LoadingState } from '@/components/states';
import { type OrderDetail, pickers } from './api';

const TABS = ['Costing', 'Fabric programs', 'Trims BOM'] as const;

export function OrderTabs({ order }: { order: OrderDetail }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Costing');
  return (
    <Card>
      <div className="flex gap-1 border-b px-2 pt-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn('rounded-t-md px-3 py-1.5 text-sm', tab === t ? 'border border-b-card bg-card font-medium -mb-px' : 'text-muted-foreground hover:text-foreground')}
          >
            {t}
          </button>
        ))}
      </div>
      <CardContent>
        {tab === 'Costing' ? <CostingPanel order={order} /> : tab === 'Fabric programs' ? <ProgramsPanel order={order} /> : <TrimsBomPanel order={order} />}
      </CardContent>
    </Card>
  );
}

// ───────── Costing ─────────
type CostRow = GridRow & { head: string; basis: string; consumption: string; rate: string };
interface Costing {
  panelCostPerPiece: string | null;
  fobPerPiece: string | null;
  exchangeRate: string | null;
  remarks: string | null;
  version: number;
  lines: { id: string; head: string; basis: string; consumption: string; rate: string }[];
}

function CostingPanel({ order }: { order: OrderDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['costing', order.id], queryFn: () => api.get<Costing>(`/orders/${order.id}/costing`) });
  const [head, setHead] = useState({ panelCostPerPiece: '', fobPerPiece: '', exchangeRate: '', remarks: '' });
  const [rows, setRows] = useState<CostRow[]>([]);
  const editable = can('orders.costing.edit') && order.status !== 'CLOSED' && order.status !== 'CANCELLED';

  useEffect(() => {
    if (!q.data) return;
    setHead({
      panelCostPerPiece: q.data.panelCostPerPiece ?? '',
      fobPerPiece: q.data.fobPerPiece ?? '',
      exchangeRate: q.data.exchangeRate ?? '',
      remarks: q.data.remarks ?? '',
    });
    setRows(q.data.lines.length ? q.data.lines.map((l) => ({ ...l, _key: l.id })) : [{ _key: newKey(), head: '', basis: 'PC', consumption: '', rate: '' }]);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/orders/${order.id}/costing`, {
        ...head,
        lines: rows.filter((r) => r.head.trim()),
        version: q.data?.version || undefined,
      }),
    onSuccess: () => {
      toast.success('Costing saved');
      void qc.invalidateQueries({ queryKey: ['costing', order.id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <LoadingState />;
  const amount = (r: CostRow) => {
    try {
      return D(r.consumption || 0).times(D(r.rate || 0));
    } catch {
      return D(0);
    }
  };
  const total = rows.reduce((a, r) => a.plus(amount(r)), D(0));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="grid gap-1">
          <Label>Panel cost / piece (₹) — values rejected & missing panels</Label>
          <Input className="num" inputMode="decimal" disabled={!editable} value={head.panelCostPerPiece} onChange={(e) => setHead({ ...head, panelCostPerPiece: e.target.value })} />
        </div>
        <div className="grid gap-1">
          <Label>FOB / piece ({order.currency})</Label>
          <Input className="num" inputMode="decimal" disabled={!editable} value={head.fobPerPiece} onChange={(e) => setHead({ ...head, fobPerPiece: e.target.value })} />
        </div>
        <div className="grid gap-1">
          <Label>Exchange rate (₹ / {order.currency})</Label>
          <Input className="num" inputMode="decimal" disabled={!editable} value={head.exchangeRate} onChange={(e) => setHead({ ...head, exchangeRate: e.target.value })} />
        </div>
        <div className="grid gap-1">
          <Label>Remarks</Label>
          <Input disabled={!editable} value={head.remarks} onChange={(e) => setHead({ ...head, remarks: e.target.value })} />
        </div>
      </div>
      <LineGrid<CostRow>
        rows={rows}
        onChange={setRows}
        readOnly={!editable}
        addLabel="Add cost head"
        newRow={() => ({ _key: newKey(), head: '', basis: 'PC', consumption: '', rate: '' })}
        columns={[
          { key: 'head', header: 'Cost head', width: '260px', placeholder: 'Fabric / Printing / Trims…' },
          { key: 'basis', header: 'Basis', width: '90px', type: 'select', options: ['PC', 'KG', 'DOZEN', 'SET'].map((v) => ({ value: v, label: v })) },
          { key: 'consumption', header: 'Consumption / garment', type: 'qty', width: '170px' },
          { key: 'rate', header: 'Rate (₹)', type: 'rate', width: '130px' },
          { key: 'amount', header: 'Amount / garment', type: 'money', width: '150px', display: (r) => formatInr(amount(r).toFixed(2)) },
        ]}
      />
      <div className="flex items-center justify-between">
        <span className="text-sm">
          Cost per garment: <b>{formatInr(total.toFixed(2))}</b>
        </span>
        {editable ? (
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save costing
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ───────── Programs ─────────
function ProgramsPanel({ order }: { order: OrderDetail }) {
  const { can } = useAuth();
  return (
    <div className="flex flex-col gap-3">
      {order.programs.length ? (
        <Table>
          <THead>
            <TR>
              <TH>Program</TH>
              <TH>Fabric</TH>
              <TH className="text-right">Required kg</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {order.programs.map((p) => (
              <TR key={p.id}>
                <TD>
                  <Link className="font-mono text-primary hover:underline" to={`/programs/${p.id}`}>
                    {p.programNo}
                  </Link>
                </TD>
                <TD>{p.fabricItem.name}</TD>
                <TD className="num">{formatKg(p.requiredKg)}</TD>
                <TD>
                  <StatusBadge status={p.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState title="No fabric programs yet" hint="A program sets the allowed process loss % for knitting, dyeing and compacting." />
      )}
      {can('programs.edit') && (order.status === 'DRAFT' || order.status === 'CONFIRMED') ? (
        <div>
          <Button asChild variant="outline">
            <Link to={`/programs/new?orderId=${order.id}`}>
              <Plus /> New fabric program
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ───────── Trims BOM ─────────
type BomRow = GridRow & { trimItemId: string; colour: string; size: string; qtyPerGarment: string; wastagePct: string; remarks: string };
interface BomLine {
  id: string;
  trimItemId: string;
  colour: string | null;
  size: string | null;
  qtyPerGarment: string;
  wastagePct: string;
  remarks: string | null;
  trimItem: { id: string; code: string; name: string; unit: string };
  requirement: { garments: number; required: string; rounded: string };
}

function TrimsBomPanel({ order }: { order: OrderDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['trims-bom', order.id], queryFn: () => api.get<BomLine[]>(`/orders/${order.id}/trims-bom`) });
  const [rows, setRows] = useState<BomRow[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const editable = can('programs.edit') && (order.status === 'DRAFT' || order.status === 'CONFIRMED');
  const blank = (): BomRow => ({ _key: newKey(), trimItemId: '', colour: '', size: '', qtyPerGarment: '1', wastagePct: '0', remarks: '' });

  useEffect(() => {
    if (!q.data) return;
    setRows(
      q.data.length
        ? q.data.map((l) => ({ _key: l.id, trimItemId: l.trimItemId, colour: l.colour ?? '', size: l.size ?? '', qtyPerGarment: l.qtyPerGarment, wastagePct: l.wastagePct, remarks: l.remarks ?? '' }))
        : [blank()],
    );
    setLabels(Object.fromEntries(q.data.map((l) => [l.trimItemId, `${l.trimItem.name} (${l.trimItem.unit})`])));
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => api.put(`/orders/${order.id}/trims-bom`, { lines: rows.filter((r) => r.trimItemId) }),
    onSuccess: () => {
      toast.success('Trims BOM saved');
      void qc.invalidateQueries({ queryKey: ['trims-bom', order.id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const req = new Map((q.data ?? []).map((l) => [`${l.trimItemId}|${l.colour ?? ''}|${l.size ?? ''}`, l.requirement]));

  if (q.isLoading) return <LoadingState />;
  return (
    <div className="flex flex-col gap-3">
      <LineGrid<BomRow>
        rows={rows}
        onChange={setRows}
        readOnly={!editable}
        newRow={blank}
        addLabel="Add trim"
        columns={[
          {
            key: 'trimItemId',
            header: 'Trim item',
            width: '260px',
            display: !editable ? (r) => labels[r.trimItemId] ?? '—' : undefined,
            render: (r, i, update) => (
              <EntityPicker
                endpoint="/items"
                query={{ type: 'TRIM' }}
                map={pickers.item}
                value={r.trimItemId}
                valueLabel={labels[r.trimItemId]}
                cellId={`${i}:0`}
                onChange={(opt) => {
                  if (opt) setLabels((l) => ({ ...l, [opt.id]: opt.label }));
                  update({ trimItemId: opt?.id ?? '' } as Partial<BomRow>);
                }}
              />
            ),
          },
          { key: 'colour', header: 'Colour (opt.)', type: 'select', width: '130px', options: order.colours.map((c) => ({ value: c, label: c })) },
          { key: 'size', header: 'Size (opt.)', type: 'select', width: '110px', options: order.sizes.map((s) => ({ value: s, label: s })) },
          { key: 'qtyPerGarment', header: 'Qty / garment', type: 'qty', width: '120px' },
          { key: 'wastagePct', header: 'Wastage %', type: 'pct', width: '100px' },
          {
            key: 'required',
            header: 'Required (saved)',
            type: 'qty',
            width: '140px',
            display: (r) => {
              const x = req.get(`${r.trimItemId}|${r.colour}|${r.size}`);
              return x ? `${formatQty(x.rounded)} (${formatQty(x.garments)} gmts)` : '—';
            },
          },
        ]}
      />
      {editable ? (
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save trims BOM
          </Button>
        </div>
      ) : null}
    </div>
  );
}
