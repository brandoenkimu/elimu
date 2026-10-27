import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cx } from '../lib/format';

interface Toast { id: number; text: string; tone: 'info' | 'good' | 'bad' }
interface ToastApi { show(text: string, tone?: Toast['tone']): void }

const Ctx = createContext<ToastApi>({ show: () => undefined });
export const useToast = (): ToastApi => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const show = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list.slice(-3), { id, text, tone }]);
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 5_500);
  }, []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('toast', `toast-${t.tone}`)}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
