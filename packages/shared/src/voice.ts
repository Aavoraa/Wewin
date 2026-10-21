import { z } from 'zod';
import { dice, tokenCover } from './scan-match';
import { normName } from './scan-normalize';

/**
 * Voice commands (Q-060). Speech is turned into text in the browser; the text is interpreted into
 * one of: open a screen, answer an enquiry from a report, or fill the open form. Voice never saves,
 * posts or approves anything — the user reviews and acts.
 */

export const VOICE_FIELD_TYPES = ['text', 'date', 'number', 'select', 'vendor', 'buyer', 'item', 'order', 'process'] as const;
export type VoiceFieldType = (typeof VOICE_FIELD_TYPES)[number];
export const VOICE_ITEM_TYPES = ['YARN', 'FABRIC', 'PANEL', 'GARMENT', 'TRIM'] as const;

const zVoiceField = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/),
  label: z.string().trim().min(1).max(60),
  type: z.enum(VOICE_FIELD_TYPES),
  options: z.array(z.string().max(40)).max(40).optional(),
  itemType: z.enum(VOICE_ITEM_TYPES).optional(),
});
export type VoiceField = z.infer<typeof zVoiceField>;

/** What the open form can be filled with: described by the page, never trusted for permissions. */
export const zVoiceFormSpec = z.object({
  title: z.string().trim().min(1).max(60),
  fields: z.array(zVoiceField).max(30),
  lines: z.object({ label: z.string().trim().min(1).max(40), fields: z.array(zVoiceField).min(1).max(15) }).optional(),
});
export type VoiceFormSpec = z.infer<typeof zVoiceFormSpec>;

export const zVoiceInterpret = z.object({
  transcript: z.string().trim().min(1, 'Nothing was heard').max(600),
  /** Screens the user may open (label + path), from the navigation the user can see. */
  screens: z.array(z.object({ label: z.string().max(60), to: z.string().regex(/^\/[a-z0-9/-]*$/) })).max(80).default([]),
  form: zVoiceFormSpec.optional(),
});

/** A resolved reference to a master record, or the closest candidates when it is not certain. */
export interface VoiceRef {
  id: string | null;
  label: string;
  heard: string;
  candidates: { id: string; label: string }[];
}
export type VoiceValue = string | VoiceRef;

export type VoiceResult =
  | { kind: 'navigate'; to: string; label: string; message: string }
  | { kind: 'answer'; message: string; report: { key: string; title: string; params: Record<string, unknown>; labels: Record<string, string>; search: string }; columns: { key: string; header: string; type?: string }[]; rows: Record<string, unknown>[]; total: number }
  | { kind: 'fill'; message: string; fields: Record<string, VoiceValue>; lines: Record<string, VoiceValue>[]; problems: string[] }
  | { kind: 'unknown'; message: string };

/**
 * Match what was said to a master record (vendor, buyer, item…): code or exact name wins; otherwise
 * the best fuzzy match must be clear of the next one. Anything less is returned as candidates for
 * the user to pick — never guessed.
 */
export function resolveByName(heard: string, rows: { id: string; code: string; name: string }[]): VoiceRef {
  const said = normName(heard);
  const empty: VoiceRef = { id: null, label: '', heard, candidates: [] };
  if (!said) return empty;
  const compact = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const byCode = rows.find((r) => compact(r.code) === compact(heard));
  if (byCode) return { id: byCode.id, label: byCode.name, heard, candidates: [] };
  const scored = rows
    .map((r) => {
      const n = normName(r.name);
      const s = n === said ? 1 : Math.max(dice(said, n), tokenCover(said, n) * 0.95, fuzzyCover(said, n) * 0.9, dice(said, normName(r.code)));
      return { r, s };
    })
    .sort((a, b) => b.s - a.s);
  const [best, next] = scored;
  if (best && best.s >= 0.75 && best.s - (next?.s ?? 0) >= 0.1) return { id: best.r.id, label: best.r.name, heard, candidates: [] };
  return { ...empty, candidates: scored.filter((x) => x.s >= 0.35).slice(0, 5).map((x) => ({ id: x.r.id, label: x.r.name })) };
}

/** Share of the spoken words that closely match a word of the name (speech misspells: "noyal" ≈ "noyyal"). */
function fuzzyCover(said: string, name: string) {
  const a = said.split(' ').filter(Boolean);
  const b = name.split(' ').filter(Boolean);
  if (!a.length || !b.length) return 0;
  return a.filter((w) => b.some((x) => x === w || (w.length >= 3 && dice(w, x) >= 0.7))).length / a.length;
}

/** Without AI: "open packing lists", "go to vendor bills", "new yarn receipt". */
export function localNavigate(transcript: string, screens: { label: string; to: string }[]): { to: string; label: string } | null {
  const t = normName(transcript).replace(/^(please )?(open|go to|goto|show|show me|take me to|new|create|add)\s+/, '');
  if (!t) return null;
  const wantsNew = /^(please )?(new|create|add)\b/.test(normName(transcript));
  let best: { s: number; screen: { label: string; to: string } } | null = null;
  for (const s of screens) {
    const n = normName(s.label);
    const singular = n.replace(/s\b/g, '');
    const score = Math.max(dice(t, n), dice(t, singular), n.includes(t) || singular.includes(t) ? 0.9 : 0);
    if (!best || score > best.s) best = { s: score, screen: s };
  }
  if (!best || best.s < 0.7) return null;
  const listOnly = /^\/(reports|alerts|stock|settings|audit|masters|bundles)/.test(best.screen.to) || best.screen.to === '/';
  return wantsNew && !listOnly ? { to: `${best.screen.to}/new`, label: `New ${best.screen.label.replace(/s$/, '').toLowerCase()}` } : best.screen;
}
