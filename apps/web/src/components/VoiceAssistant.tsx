import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Mic, MicOff, Send, Type } from 'lucide-react';
import { type VoiceResult } from '@wewin/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSpeech } from '@/lib/speech';
import { type VoiceFill, useVoice, useVoiceConfig } from '@/lib/voice';
import { cn } from '@/lib/utils';
import { NAV } from '@/nav';
import { formatCell } from './DataTable';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';
import { Textarea } from './ui/input';
import { Table, TBody, TD, TH, THead, TR } from './ui/table';

type Target = HTMLInputElement | HTMLTextAreaElement;
const EXAMPLES_FORM = ['Mill Kaveri Spinning, invoice KSM 0418, lot KSM-2601 1000 kilo at 284', 'Navy 2Y 40 pieces, navy 4Y 38 pieces'];
const EXAMPLES = ['How much 30s yarn is in the yarn store?', 'Which D.C.s are pending at Noyyal?', 'Open vendor bills', 'New outward D.C.'];

/** Put text into a field the user was typing in (works with react-hook-form's registered inputs). */
function typeInto(el: Target, text: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const next = el.value ? `${el.value} ${text}` : text;
  setter?.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
}
const dictatable = (el: Element | null): el is Target =>
  (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ['text', 'search', ''].includes(el.type))) && !el.disabled && !el.readOnly;

/**
 * Top-bar microphone (Alt+V): ask a question, open a screen, or fill the open form. Voice never
 * saves or posts — results open, answer or fill fields for the user to check.
 */
export function VoiceAssistant() {
  const cfg = useVoiceConfig();
  const { can } = useAuth();
  const voice = useVoice();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<VoiceResult | null>(null);
  const target = useRef<Target | null>(null);
  const speech = useSpeech(cfg.data?.language ?? 'en-IN');
  const screens = useMemo(() => NAV.flatMap((g) => g.items).filter((i) => can(i.perm)).map((i) => ({ label: i.label, to: i.to })), [can]);

  const ask = useMutation({
    mutationFn: (transcript: string) => api.post<VoiceResult>('/voice/interpret', { transcript, screens, ...(voice.form ? { form: voice.form.spec } : {}) }),
    onSuccess: (r) => {
      setResult(r);
      if (r.kind === 'navigate') {
        navigate(r.to);
        setOpen(false);
      }
      if (r.kind === 'fill') voice.form?.apply(r as VoiceFill);
    },
  });

  const begin = () => {
    const el = document.activeElement;
    target.current = dictatable(el) ? el : null;
    setResult(null);
    ask.reset();
    setOpen(true);
    speech.start();
  };
  useEffect(() => {
    voice.setOpen(begin);
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyV') {
        e.preventDefault();
        begin();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // Send as soon as the user stops speaking (they can still edit and resend).
  const wasListening = useRef(false);
  useEffect(() => {
    if (wasListening.current && !speech.listening && speech.text && !speech.error && cfg.data?.ai && !target.current) ask.mutate(speech.text);
    wasListening.current = speech.listening;
  }, [speech.listening]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cfg.data?.enabled) return null;
  const formMode = !!voice.form;

  return (
    <>
      <Button variant="ghost" size="icon" onClick={begin} aria-label="Voice command (Alt+V)" title="Voice command (Alt+V)">
        <Mic />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) speech.stop();
        }}
      >
        <DialogContent
          title={formMode ? `Fill ${voice.form!.spec.title.toLowerCase()} by voice` : 'Ask or command'}
          description={
            formMode
              ? 'Say what you would type: names, numbers and dates. Fields are filled for you to check; nothing is saved until you save.'
              : 'Ask a question, or say which screen to open.'
          }
          className="max-w-2xl"
        >
          <div className="grid gap-3">
            <div className="flex items-start gap-2">
              <Button
                type="button"
                variant={speech.listening ? 'default' : 'outline'}
                size="icon"
                className={cn('shrink-0', speech.listening && 'animate-pulse')}
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
                aria-label={speech.listening ? 'Stop listening' : 'Listen again'}
                disabled={!speech.supported}
              >
                {speech.listening ? <Mic /> : <MicOff />}
              </Button>
              <Textarea
                id="voice-text"
                rows={2}
                value={speech.text}
                onChange={(e) => speech.setText(e.target.value)}
                placeholder={speech.listening ? 'Listening…' : speech.supported ? 'Speak, or type here' : 'Type your request'}
                aria-label="What you said"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && speech.text.trim()) {
                    e.preventDefault();
                    ask.mutate(speech.text.trim());
                  }
                }}
              />
            </div>
            {speech.error ? <p className="text-sm text-destructive">{speech.error}</p> : null}
            <div className="flex flex-wrap gap-2">
              {cfg.data.ai || !target.current ? (
                <Button type="button" loading={ask.isPending} disabled={!speech.text.trim()} onClick={() => ask.mutate(speech.text.trim())}>
                  <Send /> {formMode ? 'Fill the form' : 'Ask'}
                </Button>
              ) : null}
              {target.current ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!speech.text.trim()}
                  onClick={() => {
                    typeInto(target.current!, speech.text.trim());
                    setOpen(false);
                  }}
                >
                  <Type /> Type into the field
                </Button>
              ) : null}
            </div>
            {!cfg.data.ai ? (
              <p className="text-xs text-muted-foreground">Questions and form filling need AI understanding, which is not switched on. Commands like “open packing lists” and typing into a field still work.</p>
            ) : null}
            {ask.isError ? <p className="text-sm text-destructive">{errorMessage(ask.error)}</p> : null}
            {result ? <ResultView result={result} onClose={() => setOpen(false)} /> : null}
            {!result && !speech.text ? (
              <div className="text-xs text-muted-foreground">
                Try: {(formMode ? EXAMPLES_FORM : EXAMPLES).map((x) => `“${x}”`).join(' · ')}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ResultView({ result, onClose }: { result: VoiceResult; onClose(): void }) {
  if (result.kind === 'unknown' || result.kind === 'navigate') return <p className="rounded-md bg-muted p-3 text-sm">{result.message}</p>;
  if (result.kind === 'fill') {
    return (
      <div className="grid gap-2 rounded-md bg-muted p-3 text-sm">
        <p className="font-medium">{result.message}</p>
        {result.problems.length ? (
          <ul className="list-inside list-disc text-amber-700 dark:text-amber-400">
            {result.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        <div>
          <Button size="sm" onClick={onClose}>
            Check the form
          </Button>
        </div>
      </div>
    );
  }
  const shown = result.rows.slice(0, 10);
  const cols = result.columns.slice(0, 7);
  const qs = new URLSearchParams({ report: result.report.key, run: '1', ...Object.fromEntries(Object.entries(result.report.labels).map(([k, v]) => [`${k}Label`, v])), ...Object.fromEntries(Object.entries(result.report.params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])) });
  return (
    <div className="grid gap-2">
      <p className="rounded-md bg-muted p-3 text-sm font-medium">{result.message}</p>
      {shown.length ? (
        <div className="max-h-72 overflow-auto rounded-md border">
          <Table>
            <THead>
              <TR>
                {cols.map((c) => (
                  <TH key={c.key} className={c.type && c.type !== 'text' && c.type !== 'date' ? 'text-right' : undefined}>
                    {c.header}
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {shown.map((r, i) => (
                <TR key={i}>
                  {cols.map((c) => (
                    <TD key={c.key} className={c.type && c.type !== 'text' && c.type !== 'date' ? 'text-right tabular-nums' : undefined}>
                      {formatCell(r[c.key], (c.type ?? 'text') as never)}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      ) : null}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{result.total > shown.length ? `Showing ${shown.length} of ${result.total}${result.report.search ? ` matching “${result.report.search}”` : ''}` : result.report.search ? `Matching “${result.report.search}”` : ''}</span>
        <Link className="text-primary hover:underline" to={`/reports?${qs.toString()}`} onClick={onClose}>
          Open {result.report.title} in Reports
        </Link>
      </div>
    </div>
  );
}
