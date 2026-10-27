import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from '../lib/format';
import { passwordChecks, passwordStrength } from '../lib/validators';
import { CheckIcon, CloseIcon, EyeIcon, EyeOffIcon } from './icons';

// ------------------------------------------------------------------ buttons

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'ghost' | 'danger' | 'quiet'; size?: 'sm' | 'md' | 'lg'; busy?: boolean };

export function Button({ kind, size, busy, className, children, disabled, type = 'button', ...rest }: BtnProps) {
  return (
    <button type={type} className={cx('btn', kind, size && `btn-${size}`, className)} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export const IconButton = ({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) => (
  <button type="button" className={cx('btn icon', className)} aria-label={label} title={label} {...rest}>{children}</button>
);

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <span className="spinner big" role="status" aria-label={label} />
);

// ------------------------------------------------------------------ fields

interface FieldShell { label: string; hint?: string; error?: string | null; optional?: boolean }

function Shell({ id, label, hint, error, optional, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={cx('field', error && 'has-error')}>
      <label htmlFor={id}>
        {label}
        {optional && <span className="opt"> (optional)</span>}
      </label>
      {children}
      {error ? <p className="field-error" id={`${id}-e`} role="alert">{error}</p> : hint ? <p className="field-hint" id={`${id}-h`}>{hint}</p> : null}
    </div>
  );
}

export function TextField({ label, hint, error, optional, className, ...rest }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error} optional={optional}>
      <input id={id} className={className} aria-invalid={!!error || undefined} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} {...rest} />
    </Shell>
  );
}

export function TextArea({ label, hint, error, optional, ...rest }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error} optional={optional}>
      <textarea id={id} aria-invalid={!!error || undefined} {...rest} />
    </Shell>
  );
}

export function SelectField({ label, hint, error, optional, children, ...rest }: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error} optional={optional}>
      <select id={id} aria-invalid={!!error || undefined} {...rest}>{children}</select>
    </Shell>
  );
}

export function PasswordField({
  label, hint, error, showStrength, matchWith, ...rest
}: FieldShell & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { showStrength?: boolean; matchWith?: string }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const value = String(rest.value ?? '');
  const strength = passwordStrength(value);
  const matches = matchWith !== undefined && value.length > 0 ? value === matchWith : null;
  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <div className="pw">
        <input id={id} type={shown ? 'text' : 'password'} aria-invalid={!!error || undefined} autoCapitalize="none" spellCheck={false} {...rest} />
        <button type="button" className="pw-toggle" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown}>
          {shown ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {showStrength && value.length > 0 && (
        <div className="strength" aria-live="polite">
          <div className="strength-bar" aria-hidden="true">
            {[1, 2, 3, 4].map((n) => <span key={n} className={cx(n <= strength.score && `on s${strength.score}`)} />)}
          </div>
          <span className="strength-label">{strength.label}</span>
          <ul className="checks">
            {passwordChecks(value).map((c) => (
              <li key={c.label} className={cx(c.ok && 'ok')}>{c.ok ? <CheckIcon width={13} height={13} /> : <span className="bullet" />} {c.label}</li>
            ))}
          </ul>
        </div>
      )}
      {matches !== null && (
        <p className={cx('match', matches ? 'ok' : 'no')} aria-live="polite">{matches ? 'Passwords match' : 'Passwords do not match yet'}</p>
      )}
    </Shell>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange(v: boolean): void; label: string; hint?: string }) {
  return (
    <label className="toggle-row">
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange(v: boolean): void; children: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={cx(o.value === value && 'on')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ surfaces

export const Card = ({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLElement>) => (
  <section className={cx('card', className)} {...rest}>{children}</section>
);

export function PageHeader({ title, sub, actions, back }: { title: string; sub?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {back}
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Empty({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'; children: ReactNode }) {
  return <span className={cx('badge-pill', `bp-${tone}`)}>{children}</span>;
}

export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="stat">
      {icon && <span className="stat-icon">{icon}</span>}
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {hint && <div className="stat-hint">{hint}</div>}
      </div>
    </div>
  );
}

export function Progress({ value, max = 100, label }: { value: number; max?: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="alert alert-bad" role="alert">
      <span>{children}</span>
      {onRetry && <button type="button" className="link" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export const Notice = ({ tone = 'info', children }: { tone?: 'info' | 'good' | 'warn'; children: ReactNode }) => (
  <div className={cx('alert', `alert-${tone}`)} role={tone === 'info' ? 'note' : 'status'}>{children}</div>
);

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading"><Spinner label={label} /><span>{label}</span></div>;
}

// ------------------------------------------------------------------ tabs

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { id: T; label: string; badge?: number | string }[]; onChange(v: T): void }) {
  return (
    <div className="tabbar" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} className={cx('tabbtn', t.id === value && 'on')} onClick={() => onChange(t.id)}>
          {t.label}
          {t.badge !== undefined && t.badge !== 0 && <span className="tab-badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ modal

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose(): void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  if (!open) return <dialog ref={ref} className="modal" aria-hidden="true" />;
  return (
    <dialog ref={ref} className={cx('modal', wide && 'wide')} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="modal-card">
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton label="Close" onClick={onClose}><CloseIcon /></IconButton>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}

export function Confirm({ open, title, children, confirmLabel = 'Confirm', danger, busy, onConfirm, onClose }: {
  open: boolean; title: string; children: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm(): void; onClose(): void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<><Button onClick={onClose}>Cancel</Button><Button kind={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>{confirmLabel}</Button></>}>
      {children}
    </Modal>
  );
}

// ------------------------------------------------------------------ misc

export function CopyText({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1800); }); }}>
      {done ? 'Copied' : label}
    </Button>
  );
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(t); }, [value, ms]);
  return v;
}
