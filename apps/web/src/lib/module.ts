import { useSyncExternalStore } from 'react';
import { type ModuleCode, isModuleCode } from '@/nav';

const KEY = 'wewin.module';
const listeners = new Set<() => void>();

function read(): ModuleCode {
  try {
    const v = localStorage.getItem(KEY);
    return isModuleCode(v) ? v : 'ALL';
  } catch {
    return 'ALL';
  }
}

/** Module the sidebar shows (Q-088), remembered on this computer. */
export function setModule(m: ModuleCode) {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // storage unavailable — the choice lasts until the page reloads
  }
  current = m;
  listeners.forEach((l) => l());
}

let current: ModuleCode = read();

export function useModule(): ModuleCode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => 'ALL' as ModuleCode,
  );
}
