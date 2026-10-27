import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../lib/format';
import { SearchIcon } from './icons';

type Entry = readonly [string, string, number, number];
interface Data { EMOJI: readonly Entry[]; EMOJI_CATEGORIES: readonly string[]; EMOJI_CATEGORY_ICONS: readonly string[] }

// The full emoji list is a separate chunk, fetched the first time a picker opens.
let loading: Promise<Data> | null = null;
const loadData = (): Promise<Data> => (loading ??= import('../lib/emojiData'));

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const RECENT_KEY = 'elimu.emoji.recent';
const TONE_KEY = 'elimu.emoji.tone';
const TONES = [
  { label: 'Default', swatch: '#f6c744', mod: '' },
  { label: 'Light', swatch: '#f7d7c4', mod: '\u{1F3FB}' },
  { label: 'Medium-light', swatch: '#d8b094', mod: '\u{1F3FC}' },
  { label: 'Medium', swatch: '#b88b69', mod: '\u{1F3FD}' },
  { label: 'Medium-dark', swatch: '#8a5a3c', mod: '\u{1F3FE}' },
  { label: 'Dark', swatch: '#4a2f24', mod: '\u{1F3FF}' },
];

const readJson = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
};
const writeJson = (key: string, value: unknown): void => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: the picker still works */ }
};

/** Puts a skin tone modifier right after the first character, dropping the variation selector that sat there. */
export function withTone(emoji: string, toneIndex: number): string {
  const mod = TONES[toneIndex]?.mod;
  if (!mod) return emoji;
  const chars = [...emoji];
  const rest = chars.slice(1).filter((c, i) => !(i === 0 && c === '️'));
  return chars[0] + mod + rest.join('');
}

export function rememberEmoji(emoji: string): void {
  const list = readJson<string[]>(RECENT_KEY, []).filter((e) => e !== emoji);
  writeJson(RECENT_KEY, [emoji, ...list].slice(0, 24));
}

interface Props {
  onPick(emoji: string): void;
  /** Keep the picker open after choosing (composer), or close it (reactions, which close from the parent). */
  autoFocus?: boolean;
  className?: string;
}

export function EmojiPicker({ onPick, autoFocus = true, className }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [tone, setTone] = useState(() => Math.min(5, Math.max(0, readJson<number>(TONE_KEY, 0))));
  const [toneOpen, setToneOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => readJson<string[]>(RECENT_KEY, []));
  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => { loadData().then(setData, () => setFailed(true)); }, []);
  useEffect(() => { if (autoFocus) search.current?.focus(); }, [autoFocus, data]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!data || !q) return null;
    const words = q.split(/\s+/);
    return data.EMOJI.filter(([e, name]) => e === q || words.every((w) => name.includes(w))).slice(0, 200);
  }, [data, q]);

  const sections = useMemo(() => {
    if (!data) return [];
    return data.EMOJI_CATEGORIES.map((label, i) => ({ label, icon: data.EMOJI_CATEGORY_ICONS[i], items: data.EMOJI.filter((e) => e[2] === i) }));
  }, [data]);

  const choose = (emoji: string) => {
    rememberEmoji(emoji);
    setRecent(readJson<string[]>(RECENT_KEY, []));
    onPick(emoji);
  };
  const show = (e: Entry) => (e[3] ? withTone(e[0], tone) : e[0]);
  const jump = (i: number) => scroller.current?.querySelector(`[data-cat="${i}"]`)?.scrollIntoView({ block: 'start' });
  const pickTone = (i: number) => { setTone(i); writeJson(TONE_KEY, i); setToneOpen(false); };

  const cell = (emoji: string, name: string, key: string) => (
    <button key={key} type="button" className="emo" onClick={() => choose(emoji)} title={name} aria-label={name || emoji}>{emoji}</button>
  );

  return (
    <div className={cx('emoji-picker', className)} role="dialog" aria-label="Emoji picker">
      <div className="emoji-top">
        <label className="emoji-search"><SearchIcon width={16} height={16} />
          <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search emoji" aria-label="Search emoji" />
        </label>
        <div className="tone-wrap">
          <button type="button" className="tone-btn" onClick={() => setToneOpen((o) => !o)} aria-label={`Skin tone: ${TONES[tone].label}`} aria-expanded={toneOpen} title="Skin tone">
            <span style={{ background: TONES[tone].swatch }} />
          </button>
          {toneOpen && (
            <div className="tone-pop" role="radiogroup" aria-label="Skin tone">
              {TONES.map((t, i) => (
                <button key={t.label} type="button" role="radio" aria-checked={i === tone} aria-label={t.label} title={t.label} className={cx('tone-dot', i === tone && 'on')} style={{ background: t.swatch }} onClick={() => pickTone(i)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {!results && data && (
        <div className="emoji-tabs" role="tablist" aria-label="Emoji categories">
          {recent.length > 0 && <button type="button" role="tab" aria-selected="false" title="Frequently used" onClick={() => scroller.current?.scrollTo({ top: 0 })}>🕘</button>}
          {sections.map((s, i) => <button key={s.label} type="button" role="tab" aria-selected="false" title={s.label} onClick={() => jump(i)}>{s.icon}</button>)}
        </div>
      )}

      <div className="emoji-scroll" ref={scroller}>
        {failed && <p className="emoji-note">Could not load the emoji list. Check your connection and try again.</p>}
        {!data && !failed && <p className="emoji-note">Loading…</p>}
        {results ? (
          results.length === 0 ? <p className="emoji-note">No emoji match “{query}”.</p> : <div className="emoji-grid">{results.map((e, i) => cell(show(e), e[1], `${i}-${e[0]}`))}</div>
        ) : data && (
          <>
            {recent.length > 0 && (
              <section><h4>Frequently used</h4><div className="emoji-grid">{recent.map((e) => cell(e, '', `r-${e}`))}</div></section>
            )}
            {sections.map((s, i) => (
              <section key={s.label} data-cat={i} className="emoji-section">
                <h4>{s.label}</h4>
                <div className="emoji-grid">{s.items.map((e, j) => cell(show(e), e[1], `${i}-${j}`))}</div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
