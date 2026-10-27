import { useEffect, useRef, useState } from 'react';
import { cx } from '../lib/format';
import { ACCENTS, SURFACES, resolveSurface, type SurfaceId } from '../lib/theme';
import { useSession } from '../state/session';
import { CheckIcon, PaletteIcon } from './icons';

export function SurfaceSwatches() {
  const { prefs, updatePrefs } = useSession();
  const options: { id: SurfaceId; label: string; bg: string; panel: string }[] = [
    { id: 'system', label: 'Match my device', bg: '#f4f6f8', panel: '#050608' },
    ...SURFACES.map((s) => ({ id: s.id as SurfaceId, label: s.label, bg: s.vars.bg, panel: s.vars.panel })),
  ];
  return (
    <div className="swatches" role="radiogroup" aria-label="Appearance">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={prefs.surface === o.id} className={cx('swatch', prefs.surface === o.id && 'on')} onClick={() => updatePrefs({ surface: o.id })}>
          <span className="swatch-chip" style={o.id === 'system' ? { background: `linear-gradient(110deg, ${o.bg} 50%, ${o.panel} 50%)` } : { background: o.bg, boxShadow: `inset 0 0 0 7px ${o.panel}` }} />
          <span>{o.label}</span>
          {prefs.surface === o.id && <CheckIcon width={15} height={15} />}
        </button>
      ))}
    </div>
  );
}

export function AccentDots() {
  const { prefs, updatePrefs } = useSession();
  return (
    <div className="accents" role="radiogroup" aria-label="Accent colour">
      {ACCENTS.map((a) => (
        <button key={a.id} type="button" role="radio" aria-checked={prefs.accent === a.id} aria-label={a.label} title={a.label}
          className={cx('accent-dot', prefs.accent === a.id && 'on')} style={{ background: a.hex }} onClick={() => updatePrefs({ accent: a.id })}>
          {prefs.accent === a.id && <CheckIcon width={14} height={14} stroke="#fff" />}
        </button>
      ))}
    </div>
  );
}

/** Quick look-and-feel picker for the top bar. Full options live in Settings. */
export function ThemeMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { prefs } = useSession();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="theme-menu" ref={box}>
      <button type="button" className={cx('btn icon', open && 'on')} aria-label="Change theme" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <PaletteIcon />
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Theme">
          <p className="pop-title">Appearance <span className="faint">· {resolveSurface(prefs.surface).label}</span></p>
          <SurfaceSwatches />
          <p className="pop-title">Accent</p>
          <AccentDots />
        </div>
      )}
    </div>
  );
}
