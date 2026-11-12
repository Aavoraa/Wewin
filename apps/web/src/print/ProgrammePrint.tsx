import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { LoadingState } from '@/components/states';
import { CompanyBlock, PrintLayout, Signatures, useCompany } from './PrintLayout';

interface Programme {
  programNo: string;
  status: string;
  colour: string | null;
  portion: string | null;
  printColour: string | null;
  fabricDescription: string | null;
  fabricType: string | null;
  greyGsm: number | null;
  gsm: number | null;
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
  order: { orderNo: string; styleNo: string };
  fabricItem: { name: string } | null;
  yarnMix: { counts: string; colour: string | null; consPct: string }[];
  sizeSpecs: ({ size: string } & Record<string, string | null>)[];
  processes: { sequence: number; allowedLossPct: string; process: { name: string } }[];
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

/** Programme Entry print (A4 landscape), laid out like the desktop screen (Q-067). */
export function ProgrammePrint({ id }: { id: string }) {
  const company = useCompany();
  const q = useQuery({
    queryKey: ['print', 'programme', id],
    queryFn: () => api.get<Programme>(`/programs/${id}`),
  });
  if (!q.data || company.isLoading) return <LoadingState />;
  const p = q.data;
  const cell = 'border border-black px-1 py-0.5';
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
          {p.status !== 'APPROVED' ? <div className="font-bold">{p.status}</div> : null}
        </div>
      </div>
      <div className="my-2 grid grid-cols-4 gap-1">
        {kv('Order Ref', `${p.order.orderNo} / ${p.order.styleNo}`)}
        {kv('Color / Combo', p.colour)}
        {kv('Portion', p.portion)}
        {kv('Print.Colour', p.printColour)}
        {kv('Fabric Description', p.fabricDescription ?? p.fabricItem?.name)}
        {kv('Fabric Type', p.fabricType)}
        {kv('Grey Gsm', p.greyGsm)}
        {kv('Final Gsm', p.gsm)}
        {kv('GG', p.gauge)}
        {kv('LL', p.loopLength)}
        {kv('Uom', p.uom)}
        {kv('Mtr to Kg', n(p.mtrToKg))}
        {kv('Coll/Cuff Reqd', p.collarCuffReqd)}
        {kv(
          'Measurement',
          `${p.withMeasurement ? 'With' : 'With Out'} · ${p.measureUnit === 'INCH' ? 'Inch' : 'CM'}`,
        )}
        {kv('Tub/Single', p.tubSingle)}
        {kv('Required kg', n(p.requiredKg))}
      </div>
      <div className="mb-2 grid grid-cols-2 gap-4">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={cell}>Yarn Counts</th>
              <th className={cell}>Yarn Colour</th>
              <th className={`${cell} text-right`}>Cons.%</th>
            </tr>
          </thead>
          <tbody>
            {p.yarnMix.map((y, i) => (
              <tr key={i}>
                <td className={cell}>{y.counts}</td>
                <td className={cell}>{y.colour ?? ''}</td>
                <td className={`${cell} text-right`}>{Number(y.consPct).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          <div className="mb-1">
            <span className="font-semibold">Prs.Template:</span> {p.processTemplate ?? ''}
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={cell}>Sl</th>
                <th className={cell}>Process</th>
                <th className={`${cell} text-right`}>Loss %</th>
              </tr>
            </thead>
            <tbody>
              {p.processes.map((r) => (
                <tr key={r.sequence}>
                  <td className={cell}>{r.sequence}</td>
                  <td className={cell}>{r.process.name.toUpperCase()}</td>
                  <td className={`${cell} text-right`}>{n(r.allowedLossPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {p.sizeSpecs.length ? (
        <table className="border-collapse">
          <thead>
            <tr>
              <th className={cell} />
              {p.sizeSpecs.map((x) => (
                <th key={x.size} className={cell}>
                  {x.size}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([k, label]) => (
              <tr key={k}>
                <td className={`${cell} font-semibold`}>{label}</td>
                {p.sizeSpecs.map((x) => (
                  <td key={x.size} className={`${cell} text-right`}>
                    {n(x[k]) || '0'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <Signatures labels={['Prepared by', 'Checked by', 'Approved by']} />
    </PrintLayout>
  );
}
