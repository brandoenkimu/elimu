import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MAX_MESSAGE_LENGTH } from '../lib/config';
import { cx } from '../lib/format';
import type { ChatMessage, LinkState } from '../lib/types';
import { EmojiPicker } from './EmojiPicker';
import { CloseIcon, ReplyIcon, SendIcon, SmileIcon } from './icons';

interface ComposerProps {
  groupName: string;
  link: LinkState;
  onSend(body: string): void;
  /** The message being answered, shown above the box until sent or cancelled. */
  replyTo?: ChatMessage | null;
  onCancelReply?(): void;
}

export function Composer({ groupName, link, onSend, replyTo, onCancelReply }: ComposerProps) {
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const [picker, setPicker] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Starting a reply puts the cursor in the box.
  useEffect(() => { if (replyTo) box.current?.focus(); }, [replyTo]);

  // Close the picker when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!picker) return;
    const away = (e: Event) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setPicker(false); };
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { setPicker(false); box.current?.focus(); } };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key); };
  }, [picker]);

  /** Inserts at the cursor (or replaces the selection) and keeps the cursor after the emoji. */
  function insert(emoji: string) {
    const el = box.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => { el?.focus(); const at = start + emoji.length; el?.setSelectionRange(at, at); });
  }

  // Grow with the text, up to a cap, then scroll.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  const trimmed = text.trim();
  const remaining = MAX_MESSAGE_LENGTH - text.length;
  const tooLong = remaining < 0;

  function submit() {
    if (!trimmed || tooLong) return;
    onSend(trimmed);
    setText('');
    box.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter adds a line. Never send while an IME is composing (Japanese, Chinese, Korean input).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape' && replyTo) onCancelReply?.();
  }

  return (
    <div className="composer">
      {link !== 'online' && (
        <p className="composer-note" role="status">
          {link === 'offline'
            ? 'You are offline. Messages you write now are kept and sent when the connection returns.'
            : 'Reconnecting. You can keep typing; messages will send once you are back.'}
        </p>
      )}
      {replyTo && (
        <div className="reply-bar">
          <ReplyIcon width={16} height={16} />
          <div className="reply-text"><b>Replying to {replyTo.senderName}</b><span>{replyTo.body}</span></div>
          <button type="button" className="btn icon quiet" onClick={onCancelReply} aria-label="Cancel reply"><CloseIcon width={16} height={16} /></button>
        </div>
      )}
      <div className="composer-row" ref={wrap}>
        {picker && <EmojiPicker className="composer-picker" onPick={insert} />}
        <button type="button" className="btn icon emoji-btn" onClick={() => setPicker((o) => !o)} aria-label="Add emoji" aria-expanded={picker} title="Emoji"><SmileIcon /></button>
        <textarea
          ref={box}
          rows={1}
          value={text}
          placeholder={`Message ${groupName}`}
          aria-label={`Message ${groupName}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="btn primary send" onClick={submit} disabled={!trimmed || tooLong} aria-label="Send message">
          <SendIcon />
        </button>
      </div>
      <div className="composer-foot">
        <span className="hint">Enter to send, Shift+Enter for a new line</span>
        {remaining < 200 && (
          <span className={cx('hint', tooLong && 'over')} aria-live="polite">
            {remaining} characters left
          </span>
        )}
      </div>
    </div>
  );
}
