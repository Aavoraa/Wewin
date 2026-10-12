import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type LoginResponse, type MeResponse, type PermissionKey } from '@wewin/shared';
import { api, refreshAccessToken, setAccessToken, setOnAuthLost } from './api';

interface AuthState {
  user: MeResponse | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  can(...perms: PermissionKey[]): boolean;
  reload(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

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

  const login = useCallback(async (username: string, password: string) => {
    const r = await api.post<LoginResponse>('/auth/login', { username, password });
    setAccessToken(r.accessToken);
    setUser(r.user);
    setStatus('authenticated');
  }, []);

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
      logout,
      reload,
      can: (...perms) => !!user && perms.every((p) => user.permissions.includes(p)),
    }),
    [user, status, login, logout, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
