import { type z } from 'zod';
import {
  D,
  type VoiceField,
  type VoiceRef,
  type VoiceResult,
  type VoiceValue,
  isValidIsoDate,
  localNavigate,
  normText,
  normalizeNumber,
  resolveByName,
  todayIst,
  type zVoiceInterpret,
} from '@wewin/shared';
import { env } from '../../config/env';
import { type CurrentUser } from '../../core/auth/auth.types';
import { AppError } from '../../core/errors/app-error';
import { logger } from '../../core/logger';
import { settingsService } from '../../core/settings/settings.service';
import { mastersService } from '../masters/masters.service';
import { ordersService } from '../orders/orders.service';
import { reportsService } from '../reports/reports.service';
import { type AiVoice, type VoiceContext, interpretWithAi } from './voice.ai';

type Input = z.output<typeof zVoiceInterpret>;
type Master = { id: string; code: string; name: string };
const ANSWER_ROWS = 50;

/** Interpreter used by the service; replaced in tests so no external service is called. */
let interpreter: (ctx: VoiceContext) => Promise<AiVoice> = interpretWithAi;
export function setVoiceInterpreter(fn: typeof interpreter) {
  interpreter = fn;
}

const aiOn = () => env.VOICE_AI_PROVIDER === 'anthropic';

/** Master lists loaded once per request, only for the reference types actually needed. */
function masters() {
  const cache = new Map<string, Promise<Master[]>>();
  const load = (key: string, fn: () => Promise<Master[]>) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key)!;
  };
  return {
    vendor: () => load('vendor', () => mastersService.vendorsForMatching()),
    buyer: () => load('buyer', () => mastersService.buyersForMatching()),
    process: () => load('process', () => mastersService.processesForMatching()),
    item: (type?: string) => load(`item:${type ?? ''}`, () => mastersService.itemsForMatching(type ? [type as 'YARN'] : ['YARN', 'FABRIC', 'PANEL', 'GARMENT', 'TRIM'])),
  };
}

async function resolveOrder(heard: string): Promise<VoiceRef> {
  const digits = heard.replace(/\D+/g, '');
  const found = new Map<string, { id: string; orderNo: string; styleNo: string; buyer: { name: string } }>();
  for (const q of [heard.trim(), digits.slice(-3), digits.slice(0, 4)].filter((x) => x.length >= 3)) {
    for (const o of await ordersService.search(q)) found.set(o.id, o);
  }
  const rows = [...found.values()].map((o) => ({ id: o.id, code: o.orderNo, name: `${o.orderNo} ${o.styleNo} ${o.buyer.name}` }));
  // "2627 001" said for WW-2627-001: compare on digits as well.
  const byDigits = digits.length >= 4 ? rows.filter((r) => r.code.replace(/\D+/g, '').endsWith(digits)) : [];
  if (byDigits.length === 1) return { id: byDigits[0]!.id, label: byDigits[0]!.code, heard, candidates: [] };
  const r = resolveByName(heard, rows);
  return r.id ? { ...r, label: rows.find((x) => x.id === r.id)!.code } : r;
}

/** Turn one spoken value into what the form field holds; problems are explained to the user. */
async function valueFor(f: VoiceField, raw: string, m: ReturnType<typeof masters>, problems: string[]): Promise<VoiceValue | undefined> {
  const v = raw.trim();
  if (!v) return undefined;
  switch (f.type) {
    case 'date':
      if (isValidIsoDate(v)) return v;
      problems.push(`${f.label}: "${v}" is not a date`);
      return undefined;
    case 'number': {
      const n = normalizeNumber(v).value;
      if (n !== null && D(n).greaterThanOrEqualTo(0)) return n;
      problems.push(`${f.label}: "${v}" is not a number`);
      return undefined;
    }
    case 'select': {
      const opt = (f.options ?? []).find((o) => normText(o) === normText(v));
      if (opt) return opt;
      problems.push(`${f.label}: "${v}" is not one of ${(f.options ?? []).join(', ')}`);
      return undefined;
    }
    case 'vendor':
    case 'buyer':
    case 'process':
    case 'item': {
      const rows = f.type === 'item' ? await m.item(f.itemType) : await m[f.type]();
      const r = resolveByName(v, rows);
      if (!r.id) problems.push(`${f.label}: "${v}" ${r.candidates.length ? 'matches several — pick one' : 'was not found'}`);
      return r;
    }
    case 'order': {
      const r = await resolveOrder(v);
      if (!r.id) problems.push(`${f.label}: "${v}" ${r.candidates.length ? 'matches several orders — pick one' : 'was not found'}`);
      return r;
    }
    default:
      return v.slice(0, 500);
  }
}

/** Every word of `search` must appear somewhere in the row (case-insensitive). */
function matchesSearch(row: Record<string, unknown>, search: string) {
  const words = normText(search).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = normText(Object.values(row).map((x) => (x === null || x === undefined ? '' : String(x))).join(' ')).replace(/\s+/g, ' ');
  const compact = hay.replace(/[^a-z0-9]/g, '');
  return words.every((w) => hay.includes(w) || compact.includes(w.replace(/[^a-z0-9]/g, '')));
}

/** A factual one-line answer built from the rows themselves (no model wording of figures). */
function summarise(title: string, columns: { key: string; header: string; type?: string }[], rows: Record<string, unknown>[]) {
  if (!rows.length) return `${title}: nothing matches.`;
  const sums = columns
    .filter((c) => c.type === 'kg' || c.type === 'money' || c.type === 'qty')
    .map((c) => {
      const total = rows.reduce((a, r) => (r[c.key] === null || r[c.key] === undefined || r[c.key] === '' ? a : a.plus(D(String(r[c.key])))), D(0));
      return `${c.header} ${c.type === 'money' ? total.toFixed(2) : total.toFixed(c.type === 'kg' ? 3 : 0)}`;
    });
  return `${title}: ${rows.length} row${rows.length === 1 ? '' : 's'}${sums.length ? ` — total ${sums.join(', ')}` : ''}.`;
}

export const voiceService = {
  async config() {
    const [enabled, language] = await Promise.all([settingsService.get('voice.enabled'), settingsService.get('voice.language')]);
    return { enabled, language, ai: aiOn() };
  },

  async interpret(input: Input, user: CurrentUser): Promise<VoiceResult> {
    if (!(await settingsService.get('voice.enabled'))) throw new AppError('VOICE_DISABLED', 'Voice commands are switched off in Settings', 409);
    if (!aiOn()) {
      const nav = localNavigate(input.transcript, input.screens);
      if (nav) return { kind: 'navigate', to: nav.to, label: nav.label, message: `Opening ${nav.label}` };
      return { kind: 'unknown', message: 'Only "open <screen>" commands work without AI. To type by voice, click into a field and use dictation.' };
    }

    const reports = reportsService.catalogue(user);
    const ai = await interpreter({
      today: todayIst(),
      transcript: input.transcript,
      screens: input.screens,
      reports: reports.map((r) => ({ key: r.key, title: r.title, description: r.description, params: r.params.map((p) => ({ key: p.key, label: p.label, type: p.type, ...('options' in p && p.options ? { options: p.options } : {}) })) })),
      form: input.form,
    });
    logger.info({ intent: ai.intent, report: ai.report_key || undefined }, 'voice request interpreted');

    if (ai.intent === 'navigate') {
      const path = ai.screen_path.trim();
      const base = path.replace(/\/new$/, '');
      const screen = input.screens.find((s) => s.to === base);
      if (!screen) return { kind: 'unknown', message: ai.reply || 'I could not find that screen.' };
      const isNew = path !== base;
      return { kind: 'navigate', to: path, label: isNew ? `New ${screen.label.replace(/s$/, '').toLowerCase()}` : screen.label, message: `Opening ${isNew ? 'a new ' + screen.label.replace(/s$/, '').toLowerCase() : screen.label}` };
    }

    if (ai.intent === 'enquiry') {
      const report = reports.find((r) => r.key === ai.report_key);
      if (!report) return { kind: 'unknown', message: ai.reply || 'I could not find a report that answers that.' };
      const m = masters();
      const params: Record<string, unknown> = {};
      const notes: string[] = [];
      const labels: Record<string, string> = {};
      for (const p of report.params) {
        const said = ai.report_params.find((x) => x.name === p.key)?.value.trim();
        if (!said) continue;
        if (p.type === 'date') {
          if (isValidIsoDate(said)) params[p.key] = said;
        } else if (p.type === 'select') {
          const opt = ('options' in p ? p.options : undefined)?.find((o) => o.value === said || normText(o.label) === normText(said));
          if (opt) params[p.key] = opt.value;
        } else if (p.type === 'vendor' || p.type === 'buyer' || p.type === 'process') {
          const r = resolveByName(said, await m[p.type]());
          if (r.id) {
            params[p.key] = r.id;
            labels[p.key] = r.label;
          }
          else notes.push(`"${said}" ${r.candidates.length ? `could be ${r.candidates.map((c) => c.label).join(' or ')}` : 'was not found'} — showing all`);
        }
      }
      const run = await reportsService.run(report.key, params, user);
      const rows = run.rows.filter((r) => matchesSearch(r as Record<string, unknown>, ai.search_text)) as Record<string, unknown>[];
      const message = [summarise(run.title, run.columns, rows), ...notes].join(' ');
      return { kind: 'answer', message, report: { key: report.key, title: run.title, params: run.params as Record<string, unknown>, labels, search: ai.search_text.trim() }, columns: run.columns, rows: rows.slice(0, ANSWER_ROWS), total: rows.length };
    }

    if (ai.intent === 'fill') {
      if (!input.form) return { kind: 'unknown', message: 'Open a form first, then dictate its contents.' };
      const m = masters();
      const problems: string[] = [];
      const fields: Record<string, VoiceValue> = {};
      for (const f of input.form.fields) {
        const said = ai.fields.find((x) => x.name === f.name)?.value ?? '';
        const v = await valueFor(f, said, m, problems);
        if (v !== undefined) fields[f.name] = v;
      }
      const lines: Record<string, VoiceValue>[] = [];
      if (input.form.lines) {
        for (const [n, l] of ai.lines.slice(0, 100).entries()) {
          const row: Record<string, VoiceValue> = {};
          for (const f of input.form.lines.fields) {
            const said = l.cells.find((c) => c.name === f.name)?.value ?? '';
            const v = await valueFor({ ...f, label: `Line ${n + 1} ${f.label.toLowerCase()}` }, said, m, problems);
            if (v !== undefined) row[f.name] = v;
          }
          if (Object.keys(row).length) lines.push(row);
        }
      }
      const filled = Object.keys(fields).length + lines.length;
      if (!filled) return { kind: 'unknown', message: ai.reply || 'I did not catch any values for this form.' };
      return { kind: 'fill', message: `Filled ${Object.keys(fields).length} field(s)${lines.length ? ` and ${lines.length} line(s)` : ''} — check and save.`, fields, lines, problems };
    }

    return { kind: 'unknown', message: ai.reply || 'Sorry, I did not understand that.' };
  },
};
