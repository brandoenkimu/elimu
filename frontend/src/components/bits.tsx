import { useEffect, useState, useSyncExternalStore } from 'react';
import { cx, initials, tone } from '../lib/format';
import { monitor } from '../lib/singletons';
import type { LinkState, NodeStatus } from '../lib/types';

export function useCluster() {
  return useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
}

/** Re-renders on an interval so "3s ago" labels stay honest. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function Avatar({ name, size = 36, square = false }: { name: string; size?: number; square?: boolean }) {
  return (
    <span className={cx('avatar', `tone-${tone(name)}`, square && 'square')} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

const STATUS_LABEL: Record<NodeStatus, string> = { healthy: 'Healthy', recovering: 'Recovering', unavailable: 'Unavailable', unknown: 'Checking' };

export function StatusDot({ status }: { status: NodeStatus | LinkState }) {
  return <span className={cx('dot', `dot-${status}`)} aria-hidden="true" />;
}

export const statusLabel = (s: NodeStatus): string => STATUS_LABEL[s];

const LINK_LABEL: Record<LinkState, string> = { online: 'Connected', connecting: 'Connecting…', reconnecting: 'Reconnecting…', offline: 'Offline, retrying' };

/** Connection indicator. Server names are shown only when `showNode` is on (administrators, or by choice in Settings). */
export function LinkPill({ state, node, showNode, onClick }: { state: LinkState; node: string | null; showNode: boolean; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag type={onClick ? 'button' : undefined} className={cx('pill', `pill-${state}`)} onClick={onClick}>
      <StatusDot status={state} />
      <span role="status" aria-live="polite">
        {LINK_LABEL[state]}
        {state === 'online' && node && showNode ? <> <span className="mono">{node}</span></> : null}
      </span>
    </Tag>
  );
}

export function RoleTag({ role, title }: { role: string; title?: string | null }) {
  if (role === 'lecturer') return <span className="role-tag lecturer">{title ? title.replace(/\.$/, '') : 'Lecturer'}</span>;
  if (role === 'admin') return <span className="role-tag admin">Admin</span>;
  return null;
}
