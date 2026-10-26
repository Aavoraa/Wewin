import { useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';

/**
 * Mobile app (A§9 "floor screens phone-first"): the same SPA with a phone shell.
 *  - On a phone (narrow screen) or inside the /m preview frame, the phone shell is used, unless the
 *    user chose "Desktop site" (remembered on that device).
 *  - On a wide screen, /m shows the preview: a phone frame running the app at phone width.
 */
const KEY = 'wewin.view';
const NARROW = '(max-width: 767px)';

const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  const mq = typeof window !== 'undefined' ? window.matchMedia(NARROW) : null;
  mq?.addEventListener('change', fn);
  window.addEventListener('storage', fn);
  return () => {
    listeners.delete(fn);
    mq?.removeEventListener('change', fn);
    window.removeEventListener('storage', fn);
  };
}

function readPref(): 'desktop' | 'auto' {
  try {
    return localStorage.getItem(KEY) === 'desktop' ? 'desktop' : 'auto';
  } catch {
    return 'auto';
  }
}

export function setViewPref(p: 'desktop' | 'auto') {
  try {
    if (p === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    // storage unavailable — the choice lasts until reload
  }
  listeners.forEach((l) => l());
}

export const inFrame = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

const snapshot = () => `${window.matchMedia(NARROW).matches ? 'n' : 'w'}|${readPref()}`;

export function useViewMode(): { mobile: boolean; preview: boolean; narrow: boolean } {
  const snap = useSyncExternalStore(subscribe, snapshot, () => 'w|auto');
  const { pathname } = useLocation();
  const narrow = snap.startsWith('n');
  const pref = snap.split('|')[1];
  const isM = pathname === '/m' || pathname.startsWith('/m/');
  const small = narrow || inFrame();
  return { mobile: small && pref !== 'desktop', preview: !small && isM, narrow: small };
}
