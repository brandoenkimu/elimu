import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CopyIcon, ReplyIcon, SmileIcon, TrashIcon } from './icons';
import { EmojiPicker, QUICK_REACTIONS } from './EmojiPicker';

export interface MenuState { x: number; y: number; mode: 'menu' | 'react' }

interface Props {
  state: MenuState;
  canReply: boolean;
  canReact: boolean;
  canDelete: boolean;
  /** Emoji this person already used on the message, shown as selected in the quick row. */
  mine: string[];
  onReply(): void;
  onCopy(): void;
  onReact(emoji: string): void;
  onDelete(): void;
  onClose(): void;
}

/** The little menu that opens when you click a message: Reply, Copy, React and Delete. */
export function MessageMenu({ state, canReply, canReact, canDelete, mine, onReply, onCopy, onReact, onDelete, onClose }: Props) {
  const [mode, setMode] = useState(state.mode);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: state.x, top: state.y });

  // Keep the popover inside the window, flipping above or to the left of the click when needed.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    let left = state.x;
    let top = state.y;
    if (left + width + pad > window.innerWidth) left = Math.max(pad, window.innerWidth - width - pad);
    if (top + height + pad > window.innerHeight) top = Math.max(pad, state.y - height);
    setPos({ left, top });
  }, [state.x, state.y, mode]);

  useEffect(() => {
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) onClose(); };
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', onClose);
    const scrolled = (e: Event) => { if (!box.current?.contains(e.target as Node)) onClose(); }; // the picker scrolls inside the menu
    window.addEventListener('scroll', scrolled, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', scrolled, true);
    };
  }, [onClose]);

  useEffect(() => { if (mode === 'menu') box.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [mode]);

  const arrows = (e: KeyboardEvent<HTMLDivElement>) => {
    if (mode !== 'menu' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  const done = (fn: () => void) => () => { fn(); onClose(); };

  return (
    <div ref={box} className={`msg-menu ${mode === 'react' ? 'react' : ''}`} style={{ left: pos.left, top: pos.top }} role={mode === 'menu' ? 'menu' : 'dialog'} aria-label="Message actions" onKeyDown={arrows}>
      {mode === 'menu' ? (
        <>
          {canReply && <button type="button" role="menuitem" onClick={done(onReply)}><ReplyIcon /> Reply</button>}
          <button type="button" role="menuitem" onClick={done(onCopy)}><CopyIcon /> Copy</button>
          {canReact && <button type="button" role="menuitem" onClick={() => setMode('react')}><SmileIcon /> React</button>}
          {canDelete && <button type="button" role="menuitem" className="danger" onClick={done(onDelete)}><TrashIcon /> Delete</button>}
        </>
      ) : (
        <>
          <div className="quick-row" role="group" aria-label="Quick reactions">
            {QUICK_REACTIONS.map((e) => (
              <button key={e} type="button" className={mine.includes(e) ? 'on' : ''} aria-label={`React with ${e}`} aria-pressed={mine.includes(e)} onClick={done(() => onReact(e))}>{e}</button>
            ))}
          </div>
          <EmojiPicker onPick={(e) => { onReact(e); onClose(); }} />
        </>
      )}
    </div>
  );
}
