import type { AuthResponse, MeView } from '@splitcab/core';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onSessionChange, refreshSession, setSession, storedRefreshToken } from './api';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: Status;
  me: MeView | null;
  signIn: (auth: AuthResponse) => Promise<void>;
  signOut: () => Promise<void>;
  setMe: (me: MeView) => void;
  reloadMe: () => Promise<MeView | null>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<MeView | null>(null);
  const queryClient = useQueryClient();

  useEffect(
    () =>
      onSessionChange((auth) => {
        if (auth) {
          setMe(auth.user);
          setStatus('signedIn');
        } else {
          setMe(null);
          setStatus('signedOut');
          queryClient.clear();
        }
      }),
    [queryClient],
  );

  // Restore the session on launch.
  useEffect(() => {
    (async () => {
      const ok = await refreshSession();
      if (!ok) {
        // Offline with a stored session: show the app and let requests retry.
        if (await storedRefreshToken()) {
          try {
            setMe(await api.get<MeView>('/v1/me'));
            setStatus('signedIn');
            return;
          } catch {
            // fall through
          }
        }
        setStatus('signedOut');
      }
    })();
  }, []);

  const signIn = useCallback((auth: AuthResponse) => setSession(auth), []);

  const signOut = useCallback(async () => {
    const token = await storedRefreshToken();
    try {
      await api.post('/v1/auth/logout', token ? { refreshToken: token } : {});
    } catch {
      // Signing out locally is what matters.
    }
    await setSession(null);
  }, []);

  const reloadMe = useCallback(async () => {
    try {
      const fresh = await api.get<MeView>('/v1/me');
      setMe(fresh);
      return fresh;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo(() => ({ status, me, signIn, signOut, setMe, reloadMe }), [status, me, signIn, signOut, reloadMe]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
