import { useQuery } from '@tanstack/react-query';
import { D } from '@wewin/shared';
import { api } from '@/lib/api';
import { formatDate, formatDateTimeIst } from '@/lib/format';
import { LoadingState } from '@/components/states';
import { useOrder } from '@/features/orders/api';
import { CompanyBlock, PrintLayout, Signatures, useCompany } from './PrintLayout';

interface ProcessRow {
  sequence: number;
  allowedLossPct: string;
  materialCostPerKg: string | null;
  plannedInputKg: string | null;
  plannedOutputKg: string | null;
  process: { name: string };
  inputItem: { code: string; name: string } | null;
  outputItem: { code: string; name: string } | null;
}

interface Programme {
  id: string;
  programNo: string;
  orderId: string;
  status: string;
  colour: string | null;
  portion: string | null;
  printColour: string | null;
  fabricDescription: string | null;
  fabricType: string | null;
  greyGsm: number | null;
  gsm: number | null;
  dia: string | null;
  gauge: string | null;
  loopLength: string | null;
  uom: string;
  mtrToKg: string | null;
  collarCuffReqd: number | null;
  withMeasurement: boolean;
  measureUnit: string;
  tubSingle: string | null;
  processTemplate: string | null;
  requiredKg: string | null;
  remarks: string | null;
  approvedAt: string | null;
  order: { orderNo: string; styleNo: string };
  fabricItem: { code: string; name: string } | null;
  yarnMix: { counts: string; colour?: string | null; consPct: string }[];
  sizeSpecs: ({ size: string } & Record<string, string | null>)[];
  processes: ProcessRow[];
}

const ROWS: [string, string][] = [
  ['length', 'Length'],
  ['lengthAllowance', 'All.'],
  ['width', 'Width'],
  ['widthAllowance', 'All.'],
  ['pcsWeight', 'Pcs.Wgt'],
  ['actDia', 'Act.Dia'],
  ['actPcsWeight', 'Act.PcsWgt'],
  ['knitDia', 'Knit.Dia'],
  ['finishDia', 'Finish.Dia'],
];
const n = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? '' : String(Number(v));
const kg3 = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(3));
const item = (i: { code: string; name: string } | null) => (i ? `${i.name} (${i.code})` : '');
const fabDetails = (d: { fabricDescription: string | null; fabricType: string | null }) =>
  [d.fabricDescription, d.fabricType].filter(Boolean).join(' · ');
const yarnDetails = (d: { yarnMix: { counts: string; consPct: string }[] }) =>
  d.yarnMix.map((l) => `${l.counts} ${Number(l.consPct)}%`).join(' + ');
const lossDetails = (d: { processes: ProcessRow[] }) =>
  d.processes.map((r) => `${r.process.name} ${Number(r.allowedLossPct)}%`).join(' → ');

/**
 * Programme Entry print (A4 landscape), laid out like the desktop screen (Q-067), with everything the
 * screen holds: order and colour quantity, every portion of the colour, fabric and yarn details (with
 * the yarn kg), the process route with items, costs and planned kg, and the size-wise grid.
 */
export function ProgrammePrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useQuery({
    queryKey: ['print', 'programme', id],
    queryFn: () => api.get<Programme>(`/programs/${id}`),
  });
  const orderId = q.data?.orderId;
  const order = useOrder(orderId);
  const siblings = useQuery({
    queryKey: ['print', 'programme-portions', orderId],
    queryFn: () => api.list<Programme>('/programs', { orderId: orderId!, pageSize: 100 }),
    enabled: !!orderId,
  });
  if (!q.data || company.isLoading || order.isLoading || siblings.isLoading) return <LoadingState />;
  const p = q.data;
  const o = order.data;

  const colourLines = (o?.lines ?? []).filter((l) => !p.colour || l.colour === p.colour);
  const qtyBySize = colourLines.reduce<Record<string, number>>((a, l) => ({ ...a, [l.size]: (a[l.size] ?? 0) + l.qty }), {});
  const orderQty = colourLines.reduce((a, l) => a + l.qty, 0);
  const portions = (siblings.data?.data ?? []).filter((x) => (x.colour ?? '') === (p.colour ?? '') && x.status !== 'CANCELLED');
  if (!portions.some((x) => x.id === p.id)) portions.unshift(p);

  // Yarn kg: the first process's planned input kg, split by the yarn-mix % (no mix → its input yarn).
  const first = [...p.processes].sort((a, b) => a.sequence - b.sequence)[0];
  const yarnKg = first?.plannedInputKg ? D(first.plannedInputKg) : null;
  const yarnRows = p.yarnMix.length
    ? p.yarnMix.map((y) => ({ counts: y.counts, colour: y.colour ?? '', pct: D(y.consPct).toFixed(2), kg: yarnKg?.times(D(y.consPct)).div(100).toFixed(3) ?? '' }))
    : first?.inputItem
      ? [{ counts: first.inputItem.name, colour: '', pct: '100.00', kg: yarnKg?.toFixed(3) ?? '' }]
      : [];

  const sizes = p.sizeSpecs.length ? p.sizeSpecs.map((x) => x.size) : (o?.sizes ?? []);
  const spec = (size: string) => p.sizeSpecs.find((x) => x.size === size);

  const cell = 'border border-black px-1 py-0.5';
  const head = `${cell} bg-slate-100 text-left font-semibold`;
  const section = 'mb-0.5 mt-2 text-[11px] font-bold uppercase';
  const kv = (label: string, value: string | number | null | undefined) => (
    <div>
      <span className="font-semibold">{label}:</span> {value ?? ''}
    </div>
  );

  return (
    <PrintLayout size="A4" landscape title={`Programme ${p.programNo}`}>
      <div className="flex items-start justify-between border-b border-black pb-2">
        <CompanyBlock c={company.data} />
        <div className="text-right">
          <div className="text-sm font-bold">PROGRAMME ENTRY</div>
          <div className="font-mono">{p.programNo}</div>
          <div className="font-bold">{p.status}</div>
          {p.approvedAt ? <div>Approved {formatDateTimeIst(p.approvedAt)}</div> : null}
        </div>
      </div>

      <div className="my-2 grid grid-cols-4 gap-1">
        {kv('Order Ref', `${p.order.orderNo} / ${p.order.styleNo}`)}
        {kv('Buyer', o?.buyer.name)}
        {kv('Buyer PO', o?.buyerPoNo)}
        {kv('Ship date', o?.shipDate ? formatDate(o.shipDate) : '')}
        {kv('Color / Combo', p.colour)}
        {kv('Order Qty', orderQty ? `${orderQty} pcs` : '')}
        {kv('Portion', p.portion)}
        {kv('Print.Colour', p.printColour)}
      </div>

      <div className={section}>Portions of {p.colour ?? 'this order'}</div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {['Programme', 'Portion', 'Fab.Colour', 'Print.Colour', 'Fab.Details', 'Yarn Details', 'Grammage', 'Loss Details', 'Req. kg', 'Status'].map((h) => (
              <th key={h} className={head}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {portions.map((x) => (
            <tr key={x.id} className={x.id === p.id ? 'font-semibold' : undefined}>
              <td className={`${cell} font-mono`}>{x.programNo}</td>
              <td className={cell}>{x.portion ?? ''}</td>
              <td className={cell}>{x.colour ?? ''}</td>
              <td className={cell}>{x.printColour ?? ''}</td>
              <td className={cell}>{fabDetails(x)}</td>
              <td className={cell}>{yarnDetails(x)}</td>
              <td className={`${cell} text-right`}>{x.gsm ?? ''}</td>
              <td className={cell}>{lossDetails(x)}</td>
              <td className={`${cell} text-right`}>{kg3(x.requiredKg)}</td>
              <td className={cell}>{x.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={section}>Fabric details</div>
      <div className="grid grid-cols-4 gap-1">
        {kv('Fabric Description', p.fabricDescription)}
        {kv('Fabric Type', p.fabricType)}
        {kv('Finished fabric item', item(p.fabricItem))}
        {kv('Required finished kg', kg3(p.requiredKg))}
        {kv('Grey Gsm', p.greyGsm)}
        {kv('Final Gsm', p.gsm)}
        {kv('GG', p.gauge)}
        {kv('LL', p.loopLength)}
        {kv('Dia', p.dia)}
        {kv('Uom', p.uom)}
        {kv('Mtr to Kg', n(p.mtrToKg))}
        {kv('Coll/Cuff Reqd', p.collarCuffReqd)}
        {kv('Measurement', `${p.withMeasurement ? 'With' : 'With Out'} · ${p.measureUnit === 'INCH' ? 'Inch' : 'CM'}`)}
        {kv('Tub/Single', p.tubSingle)}
        {kv('Prs.Template', p.processTemplate)}
        {kv('Remarks', p.remarks)}
      </div>

      <div className="grid grid-cols-[2fr_5fr] gap-4">
        <div>
          <div className={section}>Yarn details</div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={head}>Yarn Counts</th>
                <th className={head}>Yarn Colour</th>
                <th className={`${head} text-right`}>Cons.%</th>
                <th className={`${head} text-right`}>Yarn kg</th>
              </tr>
            </thead>
            <tbody>
              {yarnRows.length ? (
                yarnRows.map((y, i) => (
                  <tr key={i}>
                    <td className={cell}>{y.counts}</td>
                    <td className={cell}>{y.colour}</td>
                    <td className={`${cell} text-right`}>{y.pct}</td>
                    <td className={`${cell} text-right`}>{y.kg}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className={cell} colSpan={4}>
                    —
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div>
          <div className={section}>Process route</div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={head}>Sl</th>
                <th className={head}>Process</th>
                <th className={head}>Input item</th>
                <th className={head}>Output item</th>
                <th className={`${head} text-right`}>Loss %</th>
                <th className={`${head} text-right`}>Input ₹/kg</th>
                <th className={`${head} text-right`}>Planned in kg</th>
                <th className={`${head} text-right`}>Planned out kg</th>
              </tr>
            </thead>
            <tbody>
              {p.processes.map((r) => (
                <tr key={r.sequence}>
                  <td className={cell}>{r.sequence}</td>
                  <td className={cell}>{r.process.name.toUpperCase()}</td>
                  <td className={cell}>{item(r.inputItem)}</td>
                  <td className={cell}>{item(r.outputItem)}</td>
                  <td className={`${cell} text-right`}>{n(r.allowedLossPct)}</td>
                  <td className={`${cell} text-right`}>{r.materialCostPerKg ? Number(r.materialCostPerKg).toFixed(2) : ''}</td>
                  <td className={`${cell} text-right`}>{kg3(r.plannedInputKg)}</td>
                  <td className={`${cell} text-right`}>{kg3(r.plannedOutputKg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {sizes.length ? (
        <>
          <div className={section}>Size-wise measurements ({p.measureUnit === 'INCH' ? 'inch' : 'cm'}; weights in g)</div>
          <table className="border-collapse">
            <thead>
              <tr>
                <th className={head} />
                {sizes.map((s) => (
                  <th key={s} className={`${head} text-right`}>
                    {s}
                  </th>
                ))}
                <th className={`${head} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={`${cell} font-semibold`}>Order pcs</td>
                {sizes.map((s) => (
                  <td key={s} className={`${cell} text-right`}>
                    {qtyBySize[s] ?? ''}
                  </td>
                ))}
                <td className={`${cell} text-right font-semibold`}>{orderQty || ''}</td>
              </tr>
              {ROWS.map(([k, label]) => (
                <tr key={k}>
                  <td className={`${cell} font-semibold`}>{label}</td>
                  {sizes.map((s) => (
                    <td key={s} className={`${cell} text-right`}>
                      {n(spec(s)?.[k])}
                    </td>
                  ))}
                  <td className={cell} />
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <Signatures
        labels={['Prepared by', 'Checked by', 'Approved by']}
        signed={[null, null, p.approvedAt ? `Approved ${formatDateTimeIst(p.approvedAt)}` : null]}
      />
    </PrintLayout>
  );
}
