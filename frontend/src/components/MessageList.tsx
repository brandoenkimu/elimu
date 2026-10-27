import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { cx, dayKey, dayLabel, formatTime } from '../lib/format';
import type { ChatMessage, LinkState } from '../lib/types';
import { useToast } from '../state/toast';
import { Avatar } from './bits';
import { QUICK_REACTIONS } from './EmojiPicker';
import { ReplyIcon, SmileIcon } from './icons';
import { MessageMenu, type MenuState } from './MessageMenu';

interface Props {
  messages: ChatMessage[];
  meId: string;
  loading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  error: string | null;
  link: LinkState;
  showNode: boolean;
  onLoadOlder(): void;
  onRetryLoad(): void;
  onRetrySend(clientMessageId: string): void;
  onReply(m: ChatMessage): void;
  onDelete(m: ChatMessage): void;
  onReact(m: ChatMessage, emoji: string): void;
  /** True for administrators and for the owner of a class or group, who may delete other people's messages. */
  canModerate: boolean;
}

/** Copies text. Falls back to a hidden textarea where the clipboard API is unavailable (plain http, older browsers). */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

const GROUP_GAP_MS = 5 * 60 * 1000;

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'msg'; key: string; message: ChatMessage; head: boolean };

function buildRows(messages: ChatMessage[]): Row[] {
  const rows: Row[] = [];
  let prev: ChatMessage | null = null;
  for (const message of messages) {
    const newDay = !prev || dayKey(prev.createdAt) !== dayKey(message.createdAt);
    if (newDay) rows.push({ kind: 'day', key: `d-${dayKey(message.createdAt)}`, label: dayLabel(message.createdAt) });
    const head =
      newDay ||
      !prev ||
      prev.senderId !== message.senderId ||
      new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() > GROUP_GAP_MS;
    rows.push({ kind: 'msg', key: message.clientMessageId, message, head });
    prev = message;
  }
  return rows;
}

export function MessageList(props: Props) {
  const { messages, meId, loading, loadingOlder, hasMore, error, link, showNode } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const last = useRef<{ first: string | null; last: string | null; height: number }>({
    first: null,
    last: null,
    height: 0,
  });
  const [unseen, setUnseen] = useState(false);
  const [menu, setMenu] = useState<{ message: ChatMessage; at: MenuState } | null>(null);
  const toast = useToast();
  const closeMenu = useCallback(() => setMenu(null), []);

  function openMenu(e: MouseEvent, message: ChatMessage, mode: MenuState['mode'] = 'menu') {
    if (message.deleted) return;
    const target = e.target as HTMLElement;
    // Let links, buttons and text selection behave normally.
    if (mode === 'menu' && (target.closest('a, button, input, textarea') || (window.getSelection()?.toString() ?? '') !== '')) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fromButton = target.closest('button');
    const x = fromButton ? fromButton.getBoundingClientRect().left : e.clientX || box.left;
    const y = fromButton ? fromButton.getBoundingClientRect().bottom + 4 : e.clientY || box.top;
    setMenu({ message, at: { x, y, mode } });
  }

  function jumpTo(id: string) {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-mid="${id}"]`);
    if (!el) { toast.show('That message is further up. Scroll up to load earlier messages.', 'info'); return; }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash');
    window.setTimeout(() => el.classList.remove('flash'), 1600);
  }

  async function copy(m: ChatMessage) {
    const ok = await copyToClipboard(m.body);
    toast.show(ok ? 'Copied to clipboard.' : 'Could not copy. Select the text and copy it by hand.', ok ? 'good' : 'bad');
  }

  const rows = useMemo(() => buildRows(messages), [messages]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = messages[0]?.clientMessageId ?? null;
    const tail = messages[messages.length - 1]?.clientMessageId ?? null;
    const before = last.current;

    if (before.first === null) {
      el.scrollTop = el.scrollHeight; // first paint of this conversation
      pinned.current = true;
    } else if (first !== before.first && tail === before.last) {
      el.scrollTop += el.scrollHeight - before.height; // older messages were added above: keep the reader's place
    } else if (tail !== before.last) {
      const mine = messages[messages.length - 1]?.senderId === meId;
      if (pinned.current || mine) {
        el.scrollTop = el.scrollHeight;
        setUnseen(false);
      } else {
        setUnseen(true);
      }
    }
    last.current = { first, last: tail, height: el.scrollHeight };
  }, [messages, meId]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (pinned.current) setUnseen(false);
    if (el.scrollTop < 80 && hasMore && !loadingOlder) props.onLoadOlder();
  }

  function jumpToLatest() {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setUnseen(false);
  }

  return (
    <div className="messages-wrap">
      <div className="messages" ref={scroller} onScroll={onScroll} role="log" aria-live="polite" aria-label="Messages">
        {hasMore && (
          <div className="older">
            <button type="button" className="link" onClick={props.onLoadOlder} disabled={loadingOlder}>
              {loadingOlder ? 'Loading…' : 'Show earlier messages'}
            </button>
          </div>
        )}

        {loading && messages.length === 0 && (
          <div className="skeleton" aria-label="Loading messages">
            {[62, 38, 74, 50].map((w, i) => (
              <div key={i} className="skeleton-row">
                <span className="skeleton-avatar" />
                <span className="skeleton-lines">
                  <span style={{ width: '22%' }} />
                  <span style={{ width: `${w}%` }} />
                </span>
              </div>
            ))}
          </div>
        )}

        {error && messages.length === 0 && (
          <div className="state-note">
            <p>{error}</p>
            <button type="button" className="btn" onClick={props.onRetryLoad}>
              Try again
            </button>
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div className="state-note">
            <p>No messages yet.</p>
            <p className="muted">Say hello and get the conversation started.</p>
          </div>
        )}

        {rows.map((row) => {
          if (row.kind === 'day') {
            return (
              <div key={row.key} className="day">
                <span>{row.label}</span>
              </div>
            );
          }
          const m = row.message;
          const own = m.senderId === meId;
          return (
            <article
              key={row.key}
              data-mid={m.id}
              className={cx('msg', !row.head && 'cont', own && 'own', m.status !== 'sent' && `is-${m.status}`, m.deleted && 'is-deleted', menu?.message.id === m.id && 'menu-open')}
              onClick={(e) => openMenu(e, m)}
              onContextMenu={(e) => openMenu(e, m)}
            >
              <div className="msg-gutter">
                {row.head ? (
                  <Avatar name={m.senderName} size={34} />
                ) : (
                  <time className="msg-hover-time">{formatTime(m.createdAt)}</time>
                )}
              </div>
              <div className="msg-main">
                {row.head && (
                  <header className="msg-head">
                    <span className="msg-name">{own ? 'You' : m.senderName}</span>
                    <time>{formatTime(m.createdAt)}</time>
                    {showNode && m.originNode && <span className="node-tag mono">{m.originNode}</span>}
                  </header>
                )}
                {m.replyTo && (
                  <button type="button" className="msg-quote" onClick={() => jumpTo(m.replyTo!.id)} aria-label={`Replying to ${m.replyTo.senderName}. Go to message`}>
                    <b>{m.replyTo.senderId === meId ? 'You' : m.replyTo.senderName}</b>
                    <span>{m.replyTo.deleted ? 'This message was deleted' : m.replyTo.body}</span>
                  </button>
                )}
                {m.deleted ? <p className="msg-body msg-deleted">This message was deleted</p> : <p className="msg-body">{m.body}</p>}
                {m.reactions.length > 0 && (
                  <div className="msg-reactions" role="group" aria-label="Reactions">
                    {m.reactions.map((r) => {
                      const mineReacted = r.userIds.includes(meId);
                      return (
                        <button key={r.emoji} type="button" className={cx('react-pill', mineReacted && 'mine')} aria-pressed={mineReacted} aria-label={`${r.emoji} ${r.userIds.length}${mineReacted ? ', you reacted' : ''}`} onClick={() => props.onReact(m, r.emoji)}>
                          <span>{r.emoji}</span><b>{r.userIds.length}</b>
                        </button>
                      );
                    })}
                  </div>
                )}
                {m.status === 'sending' && (
                  <p className="msg-state">{link === 'online' ? 'Sending…' : 'Waiting for connection. It will send automatically.'}</p>
                )}
                {m.status === 'failed' && (
                  <p className="msg-state failed">
                    Not sent{m.error ? `: ${m.error}` : '.'}{' '}
                    <button type="button" className="link" onClick={() => props.onRetrySend(m.clientMessageId)}>
                      Try again
                    </button>
                  </p>
                )}
                {!row.head && showNode && m.originNode && m.status === 'sent' && (
                  <span className="node-tag mono inline">{m.originNode}</span>
                )}
              </div>
              {m.status === 'sent' && !m.deleted && (
                <div className="msg-tools" role="toolbar" aria-label="Message shortcuts">
                  <button type="button" aria-label="Reply" title="Reply" onClick={() => props.onReply(m)}><ReplyIcon width={16} height={16} /></button>
                  <button type="button" aria-label={`React with ${QUICK_REACTIONS[0]}`} title={`React ${QUICK_REACTIONS[0]}`} onClick={() => props.onReact(m, QUICK_REACTIONS[0])}>{QUICK_REACTIONS[0]}</button>
                  <button type="button" aria-label="More reactions" title="Add reaction" onClick={(e) => openMenu(e, m, 'react')}><SmileIcon width={16} height={16} /></button>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {unseen && (
        <button type="button" className="jump" onClick={jumpToLatest}>
          New messages ↓
        </button>
      )}

      {menu && (
        <MessageMenu
          key={`${menu.message.id}-${menu.at.mode}`}
          state={menu.at}
          canReply={menu.message.status === 'sent' && !menu.message.deleted}
          canReact={menu.message.status === 'sent' && !menu.message.deleted}
          canDelete={menu.message.status === 'sent' && !menu.message.deleted && (menu.message.senderId === meId || props.canModerate)}
          mine={menu.message.reactions.filter((r) => r.userIds.includes(meId)).map((r) => r.emoji)}
          onReply={() => props.onReply(menu.message)}
          onCopy={() => void copy(menu.message)}
          onReact={(emoji) => props.onReact(menu.message, emoji)}
          onDelete={() => props.onDelete(menu.message)}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
