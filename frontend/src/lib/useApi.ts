import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';
import { api } from './singletons';

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload(): void;
  setData(next: T | ((prev: T | null) => T | null)): void;
}

/** Loads a GET endpoint, reloads when `path` changes (pass null to skip), and exposes reload and local updates. */
export function useGet<T>(path: string | null): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (path === null) { setLoading(false); return; }
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    api.get<T>(path).then(
      (res) => { if (mine === seq.current) { setData(res); setLoading(false); } },
      (err: unknown) => {
        if (mine !== seq.current) return;
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setLoading(false);
      },
    );
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload, setData };
}

export const errorText = (err: unknown, fallback = 'Something went wrong. Please try again.'): string =>
  err instanceof ApiError ? err.message : fallback;

/** Field-level messages from a validation error, keyed by field name. */
export const fieldErrors = (err: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (err instanceof ApiError && err.issues) for (const i of err.issues) if (!(i.field in out)) out[i.field] = i.message;
  return out;
};
