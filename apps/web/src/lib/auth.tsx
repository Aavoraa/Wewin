import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type LoginResponse, type MeResponse, type PermissionKey } from '@wewin/shared';
import { api, refreshAccessToken, setAccessToken, setOnAuthLost } from './api';

interface AuthState {
  user: MeResponse | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login(username: string, password: string, unitId?: string): Promise<void>;
  /** Work in another unit: new tokens, and every cached page is dropped (Q-085). */
  switchUnit(unitId: string): Promise<void>;
  logout(): Promise<void>;
  can(...perms: PermissionKey[]): boolean;
  reload(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const UNIT_KEY = 'wewin.unitId';
/** Unit picked last time on this computer, preselected at login. */
export function rememberedUnit(): string | null {
  try {
    return localStorage.getItem(UNIT_KEY);
  } catch {
    return null;
  }
}
function rememberUnit(id: string) {
  try {
    localStorage.setItem(UNIT_KEY, id);
  } catch {
    // storage unavailable — the login screen just won't preselect it
  }
}

/** Auth lives in React context; the access token only in memory (A§9/A§10). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const qc = useQueryClient();

  const reload = useCallback(async () => {
    setUser(await api.get<MeResponse>('/auth/me'));
  }, []);

  useEffect(() => {
    setOnAuthLost(() => {
      setAccessToken(null);
      setUser(null);
      setStatus('anonymous');
      qc.clear();
    });
    // Restore the session from the httpOnly refresh cookie on page load.
    void (async () => {
      if (await refreshAccessToken()) {
        try {
          await reload();
          setStatus('authenticated');
          return;
        } catch {
          /* fall through */
        }
      }
      setStatus('anonymous');
    })();
  }, [qc, reload]);

  const login = useCallback(async (username: string, password: string, unitId?: string) => {
    const r = await api.post<LoginResponse>('/auth/login', { username, password, unitId });
    setAccessToken(r.accessToken);
    setUser(r.user);
    rememberUnit(r.user.unit.id);
    setStatus('authenticated');
  }, []);

  const switchUnit = useCallback(
    async (unitId: string) => {
      const r = await api.post<LoginResponse>('/auth/switch-unit', { unitId });
      setAccessToken(r.accessToken);
      qc.clear();
      setUser(r.user);
      rememberUnit(r.user.unit.id);
    },
    [qc],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      setUser(null);
      setStatus('anonymous');
      qc.clear();
    }
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      status,
      login,
      switchUnit,
      logout,
      reload,
      can: (...perms) => !!user && perms.every((p) => user.permissions.includes(p)),
    }),
    [user, status, login, switchUnit, logout, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
