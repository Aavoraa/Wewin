import { z } from 'zod';
import { D, type DecimalLike, zDecimal, zKg, zPct, zRate } from './decimal';
import { zDate } from './dates';
import { zListQuery, zRef } from './api';
import { zCode, zOptional } from './masters';

export const ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'CLOSED', 'CANCELLED'] as const;
export const PROGRAM_STATUSES = ['DRAFT', 'APPROVED', 'CANCELLED'] as const;

const zLabel = z.string().trim().min(1).max(30);

export const zOrderLine = z.object({
  colour: zLabel,
  size: zLabel,
  qty: z.coerce.number().int('Whole pieces only').min(1, 'Quantity must be at least 1').max(10_000_000),
  unitPrice: zOptional(zRate()),
});

export const zOrderComponent = z.object({
  code: zCode,
  name: z.string().trim().min(1).max(60),
  panelItemId: zRef(),
  pcsPerGarment: z.coerce.number().int().min(1).max(20),
});

const orderShape = z.object({
  orderNo: zCode,
  buyerId: zRef(),
  buyerPoNo: z.string().trim().min(1).max(60),
  poDate: zDate(),
  shipDate: zOptional(zDate()),
  styleNo: z.string().trim().min(1).max(60),
  styleName: zOptional(z.string().trim().max(120)),
  description: zOptional(z.string().trim().max(500)),
  garmentItemId: zRef(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  colours: z.array(zLabel).min(1, 'Add at least one colour').max(40),
  sizes: z.array(zLabel).min(1, 'Add at least one size').max(20),
  lines: z.array(zOrderLine).min(1, 'Enter quantities in the colour × size matrix'),
  components: z.array(zOrderComponent).min(1, 'Add the garment components (panels)'),
  remarks: zOptional(z.string().trim().max(500)),
  /** Create only: the scanned buyer PO this order was filled from (marks the scan as used). */
  sourceScanId: zOptional(zRef()),
});

/** Matrix rules: unique colour/size, every line inside the declared colours × sizes, unique component codes. */
function orderRules(v: Pick<z.output<typeof orderShape>, 'colours' | 'sizes' | 'lines' | 'components' | 'poDate' | 'shipDate'>, ctx: z.RefinementCtx) {
  const dup = (arr: string[]) => arr.find((x, i) => arr.indexOf(x) !== i);
  const dc = dup(v.colours.map((c) => c.toUpperCase()));
  if (dc) ctx.addIssue({ code: 'custom', path: ['colours'], message: `Duplicate colour ${dc}` });
  const ds = dup(v.sizes.map((s) => s.toUpperCase()));
  if (ds) ctx.addIssue({ code: 'custom', path: ['sizes'], message: `Duplicate size ${ds}` });
  const seen = new Set<string>();
  v.lines.forEach((l, i) => {
    const k = `${l.colour}|${l.size}`;
    if (seen.has(k)) ctx.addIssue({ code: 'custom', path: ['lines', i], message: `Duplicate cell ${l.colour} / ${l.size}` });
    seen.add(k);
    if (!v.colours.includes(l.colour)) ctx.addIssue({ code: 'custom', path: ['lines', i, 'colour'], message: `Unknown colour ${l.colour}` });
    if (!v.sizes.includes(l.size)) ctx.addIssue({ code: 'custom', path: ['lines', i, 'size'], message: `Unknown size ${l.size}` });
  });
  const cc = dup(v.components.map((c) => c.code));
  if (cc) ctx.addIssue({ code: 'custom', path: ['components'], message: `Duplicate component ${cc}` });
  if (v.shipDate && v.shipDate < v.poDate) ctx.addIssue({ code: 'custom', path: ['shipDate'], message: 'Ship date is before the PO date' });
}

export const zOrderInput = orderShape.superRefine(orderRules);
export const zOrderUpdate = orderShape.extend({ version: z.number().int().min(1) }).superRefine(orderRules);
export type OrderInput = z.input<typeof zOrderInput>;
export const zOrderListQuery = zListQuery.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  buyerId: zRef().optional(),
  from: zDate().optional(),
  to: zDate().optional(),
  active: z.enum(['true', 'false', 'all']).optional(),
});

export const zCostingLine = z.object({
  head: z.string().trim().min(1).max(80),
  basis: z.string().trim().min(1).max(20),
  consumption: zDecimal({ scale: 4 }),
  rate: zRate(),
});
export const zCostingInput = z.object({
  panelCostPerPiece: zOptional(zRate()),
  fobPerPiece: zOptional(zRate()),
  exchangeRate: zOptional(zRate({ positive: true })),
  remarks: zOptional(z.string().trim().max(500)),
  lines: z.array(zCostingLine).max(80).default([]),
  version: z.number().int().min(1).optional(),
});

export const zProgramProcess = z.object({
  sequence: z.coerce.number().int().min(1).max(20),
  processId: zRef(),
  /** Optional on a draft; required to approve (Q-070). */
  inputItemId: zOptional(zRef()),
  outputItemId: zOptional(zRef()),
  allowedLossPct: zPct(),
  materialCostPerKg: zOptional(zRate()),
  plannedVendorId: zOptional(zRef()),
});
/** Programme entry (Q-067): yarn mix of the portion — counts, colour and share of the fabric weight. */
export const zYarnMixLine = z.object({
  yarnItemId: zOptional(zRef()),
  counts: z.string().trim().min(1, 'Give the yarn counts').max(60),
  colour: zOptional(z.string().trim().max(30)),
  consPct: zPct({ positive: true }),
});
export type YarnMixLine = z.input<typeof zYarnMixLine>;
const zMeasure = zOptional(zDecimal({ scale: 3, max: '100000' }));
/** Size-wise measurements: length / width with allowances, piece weight (g), actual dia, actual piece weight (g), knit and finish dia. */
export const zSizeSpec = z.object({
  size: z.string().trim().min(1).max(30),
  length: zMeasure,
  lengthAllowance: zMeasure,
  width: zMeasure,
  widthAllowance: zMeasure,
  pcsWeight: zMeasure,
  actDia: zMeasure,
  actPcsWeight: zMeasure,
  knitDia: zMeasure,
  finishDia: zMeasure,
});
export type SizeSpec = z.input<typeof zSizeSpec>;
export const FABRIC_TYPES = ['Knits', 'Woven'] as const;
export const PROGRAM_UOMS = ['Kgs', 'Mtrs'] as const;

const programShape = z.object({
  orderId: zRef(),
  /** Fabric item and required kg are optional on a draft; required to approve (Q-070). */
  fabricItemId: zOptional(zRef()),
  colour: zOptional(z.string().trim().max(30)),
  requiredKg: zOptional(zKg({ positive: true })),
  gsm: zOptional(z.coerce.number().int().min(1).max(2000)),
  dia: zOptional(z.string().trim().max(30)),
  remarks: zOptional(z.string().trim().max(500)),
  portion: zOptional(z.string().trim().max(40)),
  printColour: zOptional(z.string().trim().max(40)),
  fabricDescription: zOptional(z.string().trim().max(100)),
  fabricType: zOptional(z.enum(FABRIC_TYPES)),
  greyGsm: zOptional(z.coerce.number().int().min(1).max(2000)),
  gauge: zOptional(z.string().trim().max(20)),
  loopLength: zOptional(z.string().trim().max(20)),
  uom: z.enum(PROGRAM_UOMS).default('Kgs'),
  mtrToKg: zOptional(zDecimal({ scale: 4, max: '10000' })),
  collarCuffReqd: zOptional(z.coerce.number().int().min(0).max(10_000_000)),
  withMeasurement: z.boolean().default(false),
  measureUnit: z.enum(['CM', 'INCH']).default('CM'),
  tubSingle: zOptional(z.string().trim().max(20)),
  processTemplate: zOptional(z.string().trim().max(60)),
  yarnMix: z.array(zYarnMixLine).max(10).default([]),
  sizeSpecs: z.array(zSizeSpec).max(40).default([]),
  /** Created from a Programme Entry screenshot in Scan invoices (Q-068). */
  sourceScanId: zOptional(zRef()),
  processes: z.array(zProgramProcess).max(20).default([]),
});
function programRules(v: { processes: { sequence: number }[]; yarnMix?: { consPct: string }[]; sizeSpecs?: { size: string }[] }, ctx: z.RefinementCtx) {
  const seqs = v.processes.map((p) => p.sequence);
  if (new Set(seqs).size !== seqs.length) ctx.addIssue({ code: 'custom', path: ['processes'], message: 'Process sequence numbers must be unique' });
  const mix = v.yarnMix ?? [];
  if (mix.length && !mix.reduce((a, l) => a.plus(D(l.consPct)), D(0)).equals(100)) ctx.addIssue({ code: 'custom', path: ['yarnMix'], message: 'Yarn consumption % must add up to 100' });
  const sizes = (v.sizeSpecs ?? []).map((x) => x.size);
  if (new Set(sizes).size !== sizes.length) ctx.addIssue({ code: 'custom', path: ['sizeSpecs'], message: 'Each size once in the measurements' });
}
export const zProgramInput = programShape.superRefine(programRules);
export const zProgramUpdate = programShape.omit({ orderId: true }).extend({ version: z.number().int().min(1) }).superRefine(programRules);
export const zProgramListQuery = zListQuery.extend({
  orderId: zRef().optional(),
  status: z.enum(PROGRAM_STATUSES).optional(),
});

export const zTrimsBomLine = z.object({
  trimItemId: zRef(),
  colour: zOptional(z.string().trim().max(30)),
  size: zOptional(z.string().trim().max(30)),
  qtyPerGarment: zDecimal({ scale: 4, positive: true }),
  wastagePct: zPct().default('0'),
  remarks: zOptional(z.string().trim().max(200)),
  /** Accessories Requirement Entry (Q-069). */
  country: zOptional(z.string().trim().max(60)),
  garDefine: zOptional(z.string().trim().max(60)),
  sizewise: z.boolean().default(false),
  colourwise: z.boolean().default(false),
  consumption: z.string().trim().min(1).max(20).default('Flat'),
});
export const zTrimsBomInput = z.object({ lines: z.array(zTrimsBomLine).max(200) });

// ───────── Pure calculations (unit tested) ─────────

export interface MatrixLine {
  colour: string;
  size: string;
  qty: number | string;
  unitPrice?: DecimalLike | null;
}

/** Totals of an order matrix: per colour, per size, grand total pieces and value. */
export function orderTotals(lines: MatrixLine[]) {
  const byColour: Record<string, number> = {};
  const bySize: Record<string, number> = {};
  let pcs = 0;
  let value = D(0);
  let priced = true;
  for (const l of lines) {
    const q = Number(l.qty) || 0;
    byColour[l.colour] = (byColour[l.colour] ?? 0) + q;
    bySize[l.size] = (bySize[l.size] ?? 0) + q;
    pcs += q;
    if (l.unitPrice === null || l.unitPrice === undefined || l.unitPrice === '') priced = false;
    else value = value.plus(D(l.unitPrice).times(q));
  }
  return { byColour, bySize, pcs, value: value.toFixed(2), fullyPriced: priced && lines.length > 0 };
}

/**
 * Trims requirement for one BOM line: Σ matching order qty × qty/garment × (1 + wastage %).
 * A BOM line with colour and/or size applies only to matching matrix cells. `rounded` = ceiling.
 */
export function trimsRequirement(
  bom: { colour?: string | null; size?: string | null; qtyPerGarment: DecimalLike; wastagePct: DecimalLike },
  lines: MatrixLine[],
): { garments: number; required: string; rounded: string } {
  const garments = lines
    .filter((l) => (!bom.colour || l.colour === bom.colour) && (!bom.size || l.size === bom.size))
    .reduce((a, l) => a + (Number(l.qty) || 0), 0);
  const req = D(garments).times(D(bom.qtyPerGarment)).times(D(1).plus(D(bom.wastagePct).div(100)));
  return { garments, required: req.toFixed(4), rounded: req.ceil().toFixed(0) };
}

/**
 * Accessories Requirement "Qty Details" (Q-069): a requirement line split by size when Sizewise, by
 * colour when ColourWise (both → colour × size), else one total. Each cell: order pieces × consumption
 * per garment × (1 + excess %), rounded up to whole units.
 */
export function accessoryQtyDetails(
  line: { colour?: string | null; size?: string | null; qtyPerGarment: DecimalLike; wastagePct: DecimalLike; sizewise: boolean; colourwise: boolean },
  lines: MatrixLine[],
): { colour: string | null; size: string | null; orderQty: number; required: string }[] {
  const scoped = lines.filter((l) => (!line.colour || l.colour === line.colour) && (!line.size || l.size === line.size));
  const cells = new Map<string, { colour: string | null; size: string | null; orderQty: number }>();
  for (const l of scoped) {
    const colour = line.colourwise ? l.colour : null;
    const size = line.sizewise ? l.size : null;
    const k = `${colour ?? ''}|${size ?? ''}`;
    const c = cells.get(k) ?? { colour, size, orderQty: 0 };
    c.orderQty += Number(l.qty) || 0;
    cells.set(k, c);
  }
  const factor = D(line.qtyPerGarment).times(D(1).plus(D(line.wastagePct).div(100)));
  return [...cells.values()].map((c) => ({ ...c, required: D(c.orderQty).times(factor).ceil().toFixed(0) }));
}

/** Planned input kg at each process, back-calculated from required output and allowed loss. */
export function programPlan(requiredKg: DecimalLike, processes: { sequence: number; allowedLossPct: DecimalLike }[]) {
  const sorted = [...processes].sort((a, b) => b.sequence - a.sequence);
  let out = D(requiredKg);
  const plan: Record<number, { outputKg: string; inputKg: string }> = {};
  for (const p of sorted) {
    const keep = D(1).minus(D(p.allowedLossPct).div(100));
    const input = keep.lte(0) ? out : out.div(keep);
    plan[p.sequence] = { outputKg: out.toFixed(3), inputKg: input.toFixed(3) };
    out = input;
  }
  return plan;
}

export interface ProgramYarnNeed {
  yarnItemId: string | null;
  counts: string | null;
  colour: string | null;
  kg: string;
}

/**
 * Yarn to buy for one fabric programme (Q-073): the planned input kg of its first process (losses of
 * every process added back by programPlan), split by the yarn mix consumption %. Without a yarn mix the
 * first process's input item takes it all. A programme whose first process takes something other than
 * yarn (e.g. grey fabric bought in) needs no yarn.
 */
export function programYarnNeed(p: {
  requiredKg: DecimalLike | null;
  processes: { sequence: number; allowedLossPct: DecimalLike; inputItemId?: string | null; inputIsYarn?: boolean }[];
  yarnMix: { yarnItemId?: string | null; counts: string; colour?: string | null; consPct: DecimalLike }[];
}): ProgramYarnNeed[] {
  if (!p.requiredKg || !D(p.requiredKg).gt(0) || !p.processes.length) return [];
  const first = [...p.processes].sort((a, b) => a.sequence - b.sequence)[0]!;
  if (first.inputItemId && first.inputIsYarn === false) return [];
  const yarnKg = D(programPlan(p.requiredKg, p.processes)[first.sequence]!.inputKg);
  const firstYarn = first.inputItemId && first.inputIsYarn ? first.inputItemId : null;
  if (!p.yarnMix.length) return firstYarn ? [{ yarnItemId: firstYarn, counts: null, colour: null, kg: yarnKg.toFixed(3) }] : [];
  return p.yarnMix.map((m) => ({
    yarnItemId: m.yarnItemId || (p.yarnMix.length === 1 ? firstYarn : null),
    counts: m.counts,
    colour: m.colour?.trim() || null,
    kg: yarnKg.times(D(m.consPct)).div(100).toFixed(3),
  }));
}

/**
 * Programme Calculate (Q-067): finished kg of a portion = Σ over sizes (pieces of the colour in that
 * size × actual piece weight in grams) ÷ 1000. The process losses are then added by programPlan.
 * Sizes without an actual piece weight are skipped and reported.
 */
export function programFinishedKg(qtyBySize: Record<string, number>, specs: { size: string; actPcsWeight?: DecimalLike | null }[]) {
  let kg = D(0);
  const missing: string[] = [];
  for (const [size, qty] of Object.entries(qtyBySize)) {
    const w = specs.find((x) => x.size === size)?.actPcsWeight;
    if (w === undefined || w === null || w === '' || D(w).isZero()) {
      if (qty > 0) missing.push(size);
      continue;
    }
    kg = kg.plus(D(qty).times(D(w)).div(1000));
  }
  return { kg: kg.toDecimalPlaces(3).toFixed(3), missing };
}

/** What still stops a draft programme from being approved (Q-070); empty = complete. */
export function programMissing(p: { fabricItemId?: string | null; requiredKg?: string | null; processes: { sequence: number; inputItemId?: string | null; outputItemId?: string | null }[] }): string[] {
  const out: string[] = [];
  if (!p.fabricItemId) out.push('finished fabric item');
  if (!p.requiredKg || !D(p.requiredKg).gt(0)) out.push('required finished kg');
  if (!p.processes.length) out.push('at least one process');
  for (const r of p.processes) {
    if (!r.inputItemId) out.push(`input item of process ${r.sequence}`);
    if (!r.outputItemId) out.push(`output item of process ${r.sequence}`);
  }
  return out;
}
