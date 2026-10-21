import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { type FieldValues, type Path, type PathValue, type UseFormReturn } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { type VoiceFormSpec, type VoiceRef, type VoiceResult, type VoiceValue } from '@wewin/shared';
import { api } from './api';

export type VoiceFill = Extract<VoiceResult, { kind: 'fill' }>;
export interface VoiceForm {
  spec: VoiceFormSpec;
  apply(fill: VoiceFill): void;
}

/** The form on screen (at most one) tells the assistant what can be filled and how. */
const Ctx = createContext<{ form: VoiceForm | null; register(f: VoiceForm | null): void; open(): void; setOpen(fn: () => void): void } | null>(null);

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<VoiceForm | null>(null);
  const opener = useRef<() => void>(() => {});
  const value = useMemo(
    () => ({ form, register: setForm, open: () => opener.current(), setOpen: (fn: () => void) => {
        opener.current = fn;
      },
    }),
    [form],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useVoice() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useVoice outside VoiceProvider');
  return c;
}

export function useVoiceConfig() {
  return useQuery({ queryKey: ['voice-config'], queryFn: () => api.get<{ enabled: boolean; language: string; ai: boolean }>('/voice/config'), staleTime: 5 * 60_000 });
}

/** Register the open form while it is editable; unregister when it closes. */
export function useRegisterVoiceForm(form: VoiceForm | null | undefined) {
  const { register } = useVoice();
  const ref = useRef(form);
  ref.current = form;
  const key = form ? JSON.stringify(form.spec) : '';
  useEffect(() => {
    if (!key) return;
    register({ spec: JSON.parse(key) as VoiceFormSpec, apply: (f) => ref.current?.apply(f) });
    return () => register(null);
  }, [key, register]);
}

const isRef = (v: VoiceValue | undefined): v is VoiceRef => typeof v === 'object' && v !== null;

/**
 * Build the voice hookup for a react-hook-form document form: header fields are set by name; a
 * master reference is set only when it resolved to one record (its label shown in the picker);
 * dictated lines are added after the lines already entered (blank lines are replaced).
 */
export function useVoiceFill<T extends FieldValues, L extends object>(opts: {
  form: UseFormReturn<T>;
  spec: VoiceFormSpec;
  enabled: boolean;
  setLabels?: (fn: (l: Record<string, string>) => Record<string, string>) => void;
  linesName?: Path<T>;
  newLine?: () => L;
  isBlankLine?: (l: L) => boolean;
  /** Convert a value for one line field (e.g. pieces as a number). */
  lineValue?: (name: string, v: string) => unknown;
  /** Lines with the same key replace each other (one colour × size cell) instead of repeating. */
  mergeKey?: (l: L) => string;
}): VoiceForm | null {
  const { form, spec, enabled, setLabels, linesName, newLine, isBlankLine, lineValue, mergeKey } = opts;
  const apply = useCallback(
    (fill: VoiceFill) => {
      const labels: Record<string, string> = {};
      const take = (v: VoiceValue | undefined): string | undefined => {
        if (v === undefined) return undefined;
        if (isRef(v)) {
          if (!v.id) return undefined;
          labels[v.id] = v.label;
          return v.id;
        }
        return v;
      };
      for (const f of spec.fields) {
        const v = take(fill.fields[f.name]);
        if (v !== undefined) form.setValue(f.name as Path<T>, v as PathValue<T, Path<T>>, { shouldDirty: true, shouldValidate: false });
      }
      if (linesName && newLine && spec.lines && fill.lines.length) {
        const current = ((form.getValues(linesName) as unknown as L[]) ?? []).filter((l) => !(isBlankLine?.(l) ?? false));
        const added = fill.lines.map((row) => {
          const line = newLine() as Record<string, unknown>;
          for (const f of spec.lines!.fields) {
            const v = take(row[f.name]);
            if (v !== undefined) line[f.name] = lineValue ? lineValue(f.name, v) : v;
          }
          return line as L;
        });
        let merged = [...current, ...added];
        if (mergeKey) merged = [...new Map(merged.map((l) => [mergeKey(l), l])).values()];
        form.setValue(linesName, merged as PathValue<T, Path<T>>, { shouldDirty: true });
      }
      if (setLabels && Object.keys(labels).length) setLabels((l) => ({ ...l, ...labels }));
    },
    [form, spec, setLabels, linesName, newLine, isBlankLine, lineValue, mergeKey],
  );
  return enabled ? { spec, apply } : null;
}
