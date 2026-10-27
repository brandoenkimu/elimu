import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, realtime } from '../lib/singletons';
import type { AppNotification } from '../lib/types';
import { useToast } from './toast';

interface Value {
  items: AppNotification[];
  unread: number;
  markAllRead(): void;
  markRead(id: string): void;
  reload(): void;
}

const Ctx = createContext<Value | null>(null);
export const useNotifications = (): Value => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNotifications must be used inside <NotificationsProvider>');
  return v;
};

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const toast = useToast();

  const reload = useCallback(() => {
    api.get<{ notifications: AppNotification[]; unread: number }>('/notifications?limit=30').then(
      (r) => { setItems(r.notifications); setUnread(r.unread); },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    reload();
    const offNotify = realtime.on('notify', (n) => {
      setItems((list) => [n, ...list.filter((x) => x.id !== n.id)].slice(0, 50));
      setUnread((u) => u + 1);
      toast.show(n.title);
    });
    // After a reconnect, anything pushed while offline is picked up from the server.
    const offOnline = realtime.on('online', reload);
    return () => { offNotify(); offOnline(); };
  }, [reload, toast]);

  const markAllRead = useCallback(() => {
    setItems((l) => l.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnread(0);
    api.post('/notifications/read', { all: true }).catch(() => undefined);
  }, []);

  const markRead = useCallback((id: string) => {
    setItems((l) => l.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnread((u) => Math.max(0, u - 1));
    api.post('/notifications/read', { ids: [id] }).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ items, unread, markAllRead, markRead, reload }), [items, unread, markAllRead, markRead, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
