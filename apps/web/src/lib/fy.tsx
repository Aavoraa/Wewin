import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { fyCodeFor, fyRangeFor, todayIst } from '@wewin/shared';
import { prefs } from './utils';

interface FyState {
  fyCode: string;
  start: string;
  end: string;
  options: string[];
  setFy(code: string): void;
}

const FyContext = createContext<FyState | null>(null);
const FY_START_MONTH = 4;

function rangeForCode(code: string) {
  const startYear = 2000 + Number(code.slice(0, 2));
  return fyRangeFor(`${startYear}-${String(FY_START_MONTH).padStart(2, '0')}-01`, FY_START_MONTH);
}

/** Financial-year switch (top bar). Registers filter their date range by the selected FY. */
export function FyProvider({ children }: { children: ReactNode }) {
  const current = fyCodeFor(todayIst(), FY_START_MONTH);
  const [fyCode, setFyCode] = useState<string>(() => prefs.get('fy', current));
  const value = useMemo<FyState>(() => {
    const r = rangeForCode(fyCode);
    const y = Number(current.slice(0, 2));
    const options = [0, 1, 2].map((d) => {
      const a = y - d;
      return `${String(a).padStart(2, '0')}-${String(a + 1).padStart(2, '0')}`;
    });
    return {
      fyCode,
      start: r.start,
      end: r.end,
      options,
      setFy: (c) => {
        prefs.set('fy', c);
        setFyCode(c);
      },
    };
  }, [fyCode, current]);
  return <FyContext.Provider value={value}>{children}</FyContext.Provider>;
}

export function useFy(): FyState {
  const ctx = useContext(FyContext);
  if (!ctx) throw new Error('useFy outside FyProvider');
  return ctx;
}
