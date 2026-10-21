import { useCallback, useEffect, useRef, useState } from 'react';

/** The browser's speech recognizer (Chrome / Edge; Safari as webkitSpeechRecognition). Not in lib.dom. */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const speechSupported = () => !!ctor();

const MESSAGES: Record<string, string> = {
  'not-allowed': 'The microphone is blocked. Allow it for this site in the browser (lock icon in the address bar).',
  'service-not-allowed': 'The microphone is blocked. Allow it for this site in the browser.',
  'no-speech': 'Nothing was heard. Speak after the beep, close to the microphone.',
  'audio-capture': 'No microphone was found.',
  network: 'The browser’s speech service could not be reached (it needs internet).',
  'language-not-supported': 'This browser cannot listen in the selected language.',
};

/**
 * Speech → text in the browser. `text` holds what was finally recognised plus what is being heard
 * now; recognition stops by itself after a pause, or with stop().
 */
export function useSpeech(lang: string) {
  const rec = useRef<Recognition | null>(null);
  const finalText = useRef('');
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => rec.current?.stop(), []);
  const start = useCallback(() => {
    const R = ctor();
    if (!R) {
      setError('This browser cannot listen. Use Chrome or Edge, or type your request.');
      return;
    }
    rec.current?.abort();
    finalText.current = '';
    setText('');
    setError(null);
    const r = new R();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) finalText.current = `${finalText.current} ${res[0]!.transcript}`.trim();
        else interim += res[0]!.transcript;
      }
      setText(`${finalText.current} ${interim}`.trim());
    };
    r.onerror = (e) => {
      if (e.error !== 'aborted') setError(MESSAGES[e.error] ?? `Listening failed (${e.error}).`);
    };
    r.onend = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError('Could not start listening. Try again.');
    }
  }, [lang]);

  useEffect(() => () => rec.current?.abort(), []);
  return { listening, text, setText, error, start, stop, supported: speechSupported() };
}
