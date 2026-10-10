import type { ApiErrorBody, AuthResponse } from '@splitcab/core';
import Constants from 'expo-constants';
import { secureStorage } from './storage';

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:3000').replace(/\/$/, '');
const REFRESH_KEY = 'splitcab.refreshToken';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type SessionListener = (auth: AuthResponse | null) => void;

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<SessionListener>();

export function onSessionChange(fn: SessionListener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function setSession(auth: AuthResponse | null) {
  accessToken = auth?.accessToken ?? null;
  if (auth) await secureStorage.set(REFRESH_KEY, auth.refreshToken);
  else await secureStorage.remove(REFRESH_KEY);
  listeners.forEach((fn) => fn(auth));
}

export const hasStoredSession = async () => Boolean(await secureStorage.get(REFRESH_KEY));
export const storedRefreshToken = () => secureStorage.get(REFRESH_KEY);

// Swaps the stored refresh token for a new pair. Concurrent callers share one request, because the
// server treats a reused refresh token as stolen and ends the session.
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const token = await secureStorage.get(REFRESH_KEY);
      if (!token) return false;
      try {
        const res = await fetch(`${API_URL}/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: token }),
        });
        if (res.status === 401) {
          await setSession(null);
          return false;
        }
        if (!res.ok) return false;
        await setSession((await res.json()) as AuthResponse);
        return true;
      } catch {
        // Offline: keep the stored session and try again later.
        return false;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
}

export async function request<T>(path: string, { method = 'GET', body, auth = true }: RequestOptions = {}): Promise<T> {
  const send = () =>
    fetch(`${API_URL}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(auth && accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res: Response;
  try {
    if (auth && !accessToken) await refreshSession();
    res = await send();
    if (auth && res.status === 401 && (await refreshSession())) res = await send();
  } catch {
    throw new ApiError(0, 'network', "Can't reach SplitCab. Check your connection and try again.");
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    // A 401 that survived a refresh attempt: refreshSession() already signed out if the session is gone.
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? 'Something went wrong. Please try again.');
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  public: {
    get: <T>(path: string) => request<T>(path, { auth: false }),
    post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body, auth: false }),
  },
};
