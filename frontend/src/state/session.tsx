import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { api, monitor, realtime } from '../lib/singletons';
import { applyTheme, loadLocalPrefs, sanitize, saveLocalPrefs, watchSystem, type Prefs } from '../lib/theme';
import type { AuthPayload, User } from '../lib/types';

type Status = 'loading' | 'anonymous' | 'authed' | 'unreachable';

interface SessionValue {
  status: Status;
  user: User | null;
  prefs: Prefs;
  login(email: string, password: string, remember: boolean): Promise<void>;
  /** Returns "pending" for lecturer accounts that wait for approval. */
  register(input: Record<string, unknown>): Promise<'signed-in' | 'pending'>;
  logout(): Promise<void>;
  logoutEverywhere(): Promise<void>;
  setUser(user: User): void;
  reloadUser(): Promise<void>;
  /** Applies at once, remembers on this device, and saves to the account when signed in. */
  updatePrefs(patch: Partial<Prefs>): void;
  retry(): void;
}

const Ctx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUserState] = useState<User | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadLocalPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => { applyTheme(prefs); }, [prefs]);
  useEffect(() => watchSystem(() => prefsRef.current), []);

  const adopt = useCallback((payload: AuthPayload | { user: User }) => {
    setUserState(payload.user);
    // The account's saved look wins over whatever this device had, so it follows the person around.
    if (payload.user.preferences && Object.keys(payload.user.preferences).length > 0) {
      const next = sanitize({ ...prefsRef.current, ...payload.user.preferences });
      setPrefs(next);
      saveLocalPrefs(next);
    }
    setStatus('authed');
  }, []);

  const restore = useCallback(async () => {
    setStatus('loading');
    try {
      adopt(await api.refresh());
    } catch (err) {
      if (err instanceof ApiError && (err.isAuth || err.status === 403)) setStatus('anonymous');
      else setStatus('unreachable');
    }
  }, [adopt]);

  useEffect(() => {
    monitor.start();
    void restore();
    return () => monitor.stop();
  }, [restore]);

  // Renew the access token a minute before it expires, for as long as someone is signed in.
  useEffect(() => {
    if (status !== 'authed') return;
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      const wait = Math.max(5_000, api.expiresAtMs - Date.now() - 60_000);
      timer = window.setTimeout(() => {
        api.refresh().then(schedule, (err: unknown) => {
          if (err instanceof ApiError && (err.isAuth || err.status === 403)) {
            setUserState(null);
            setStatus('anonymous');
          } else {
            timer = window.setTimeout(schedule, 5_000);
          }
        });
      }, wait);
    };
    schedule();
    const stop = api.onToken((token) => { if (token) schedule(); });
    return () => { window.clearTimeout(timer); stop(); };
  }, [status]);

  useEffect(
    () => realtime.on('authLost', () => { api.clearSession(); setUserState(null); setStatus('anonymous'); }),
    [],
  );

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    const next = sanitize({ ...prefsRef.current, ...patch });
    setPrefs(next);
    saveLocalPrefs(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (!api.accessToken) return;
      api.put('/profile/preferences', next).catch(() => undefined); // saving to the account is best-effort
    }, 600);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      prefs,
      async login(email, password, remember) { adopt(await api.login(email, password, remember)); },
      async register(input) {
        const result = await api.register(input);
        if ('pending' in result) return 'pending';
        adopt(result);
        return 'signed-in';
      },
      async logout() {
        realtime.stop();
        await api.logout();
        setUserState(null);
        setStatus('anonymous');
      },
      async logoutEverywhere() {
        realtime.stop();
        await api.logoutAll().catch(() => api.clearSession());
        setUserState(null);
        setStatus('anonymous');
      },
      setUser: setUserState,
      async reloadUser() { const { user: fresh } = await api.me(); setUserState(fresh); },
      updatePrefs,
      retry: () => void restore(),
    }),
    [status, user, prefs, adopt, restore, updatePrefs],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
