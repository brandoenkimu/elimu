const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export const formatTime = (iso: string): string => timeFormat.format(new Date(iso));

const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY = 24 * 60 * 60 * 1000;

export const dayKey = (iso: string): string => String(startOfDay(new Date(iso)));

/** "Today", "Yesterday", or "Monday 20 October". */
export function dayLabel(iso: string): string {
  const date = new Date(iso);
  const diff = Math.round((startOfDay(new Date()) - startOfDay(date)) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/** Compact timestamp for the conversation list. */
export function listTime(iso: string): string {
  const date = new Date(iso);
  const diff = Math.round((startOfDay(new Date()) - startOfDay(date)) / DAY);
  if (diff === 0) return formatTime(iso);
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Stable colour slot (0-5) for a given string, so a person keeps the same avatar colour. */
export function tone(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % 6;
}

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

export function secondsAgo(timestamp: number | null, now: number): string {
  if (!timestamp) return 'not yet';
  const s = Math.max(0, Math.round((now - timestamp) / 1000));
  return s < 2 ? 'just now' : `${s}s ago`;
}

export function fullDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** "in 3 days", "2 hours ago", "in 40 min". */
export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const diffMs = new Date(iso).getTime() - now;
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(diffMs / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  return rtf.format(Math.round(diffMs / 86_400_000), 'day');
}

export const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

export const yearLabel = (n: number | null | undefined): string => (n ? `Year ${n}` : '');
export const roleLabel = (r: string): string => (r === 'lecturer' ? 'Lecturer' : r === 'admin' ? 'Administrator' : 'Student');

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
