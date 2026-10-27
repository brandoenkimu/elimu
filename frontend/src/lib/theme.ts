/**
 * Theme engine.
 *
 * Two independent choices, matching how people think about it:
 *   - a SURFACE (what the app looks like: Pure White, Beige, Carbon Gray, Navy Blue, Midnight Black, or follow the device)
 *   - an ACCENT (the highlight colour: ten of them)
 *
 * Accent colours are adjusted automatically so text and buttons stay readable on whichever
 * surface is active: a pale gold link on white is darkened until it reaches a 4.5:1 contrast ratio.
 */
export type SurfaceId = 'system' | 'white' | 'beige' | 'carbon' | 'navy' | 'midnight';
export type AccentId = 'electric' | 'ocean' | 'cyan' | 'emerald' | 'royal' | 'purple' | 'crimson' | 'gold' | 'orange' | 'pink';
export type FontSize = 'sm' | 'md' | 'lg';
export type Density = 'comfortable' | 'compact';

export interface Prefs {
  surface: SurfaceId;
  accent: AccentId;
  fontSize: FontSize;
  density: Density;
  showServerDetails: boolean;
  allowRequests: boolean;
  showEmail: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  surface: 'system',
  accent: 'emerald',
  fontSize: 'md',
  density: 'comfortable',
  showServerDetails: false,
  allowRequests: true,
  showEmail: false,
};

interface SurfaceDef {
  id: Exclude<SurfaceId, 'system'>;
  label: string;
  dark: boolean;
  vars: Record<string, string>;
}

export const SURFACES: SurfaceDef[] = [
  {
    id: 'white', label: 'Pure White', dark: false,
    vars: { bg: '#f4f6f8', panel: '#ffffff', raised: '#eef1f4', line: '#dde2e8', strong: '#c3cad3', text: '#14181d', muted: '#566170', faint: '#7a8695', shadow: '16 24 40' },
  },
  {
    id: 'beige', label: 'Beige', dark: false,
    vars: { bg: '#efe8da', panel: '#faf6ed', raised: '#f1eadb', line: '#ddd2bc', strong: '#c4b79d', text: '#2a241b', muted: '#665c4b', faint: '#8a7f6c', shadow: '60 40 10' },
  },
  {
    id: 'carbon', label: 'Carbon Gray', dark: true,
    vars: { bg: '#1c1e21', panel: '#26292d', raised: '#30343a', line: '#3a3f45', strong: '#4c525a', text: '#eceef0', muted: '#a4abb3', faint: '#7f8791', shadow: '0 0 0' },
  },
  {
    id: 'navy', label: 'Navy Blue', dark: true,
    vars: { bg: '#0a1730', panel: '#112245', raised: '#183058', line: '#25406f', strong: '#35558a', text: '#e8eefb', muted: '#9fb2d6', faint: '#7890b8', shadow: '0 0 0' },
  },
  {
    id: 'midnight', label: 'Midnight Black', dark: true,
    vars: { bg: '#050608', panel: '#0f1114', raised: '#171a1e', line: '#23272d', strong: '#363b43', text: '#f1f2f4', muted: '#959ca6', faint: '#6f7782', shadow: '0 0 0' },
  },
];

export const ACCENTS: { id: AccentId; label: string; hex: string }[] = [
  { id: 'electric', label: 'Electric Blue', hex: '#2b6bff' },
  { id: 'ocean', label: 'Ocean Blue', hex: '#0d82c4' },
  { id: 'cyan', label: 'Cyan', hex: '#0bb5d4' },
  { id: 'emerald', label: 'Emerald Green', hex: '#0f9d63' },
  { id: 'royal', label: 'Royal Purple', hex: '#5b3bc9' },
  { id: 'purple', label: 'Purple', hex: '#a24de0' },
  { id: 'crimson', label: 'Crimson Red', hex: '#d3213f' },
  { id: 'gold', label: 'Gold', hex: '#dba300' },
  { id: 'orange', label: 'Orange', hex: '#f07818' },
  { id: 'pink', label: 'Pink', hex: '#e8478f' },
];

// ------------------------------------------------------------------ colour maths (WCAG 2.x)

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = (hex: string): number => { const [r, g, b] = hexToRgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}
function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/** Moves a colour lighter or darker, keeping its hue, until it reaches `min` contrast against `against`. */
export function ensureContrast(hex: string, against: string, min = 4.5): string {
  if (contrast(hex, against) >= min) return hex;
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  const goLighter = luminance(against) < 0.4;
  for (let step = 1; step <= 40; step++) {
    const next = Math.min(1, Math.max(0, l + (goLighter ? 1 : -1) * step * 0.02));
    const candidate = hslToHex(h, s, next);
    if (contrast(candidate, against) >= min) return candidate;
  }
  return goLighter ? '#ffffff' : '#000000';
}

function shiftLightness(hex: string, delta: number): string {
  const [h, sat, l] = rgbToHsl(hexToRgb(hex));
  return hslToHex(h, sat, Math.min(1, Math.max(0, l + delta)));
}

/** Black or white text, whichever reads better on this colour. */
export const inkOn = (hex: string): string => (contrast('#ffffff', hex) >= contrast('#101418', hex) ? '#ffffff' : '#101418');

// ------------------------------------------------------------------ applying

const STORAGE_KEY = 'elimu.prefs.v1';

export function loadLocalPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitize(JSON.parse(raw) as Partial<Prefs>);
  } catch {
    // storage unavailable or corrupted: fall through to defaults
  }
  return { ...DEFAULT_PREFS };
}

export function saveLocalPrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // The choice still applies for this visit.
  }
}

/** Accepts anything (server data, old storage) and returns a valid Prefs. */
export function sanitize(input: Partial<Prefs> | Record<string, unknown> | null | undefined): Prefs {
  const p = (input ?? {}) as Record<string, unknown>;
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  return {
    surface: pick(p.surface, ['system', ...SURFACES.map((s) => s.id)] as SurfaceId[], DEFAULT_PREFS.surface),
    accent: pick(p.accent, ACCENTS.map((a) => a.id), DEFAULT_PREFS.accent),
    fontSize: pick(p.fontSize, ['sm', 'md', 'lg'] as FontSize[], DEFAULT_PREFS.fontSize),
    density: pick(p.density, ['comfortable', 'compact'] as Density[], DEFAULT_PREFS.density),
    showServerDetails: typeof p.showServerDetails === 'boolean' ? p.showServerDetails : DEFAULT_PREFS.showServerDetails,
    allowRequests: typeof p.allowRequests === 'boolean' ? p.allowRequests : DEFAULT_PREFS.allowRequests,
    showEmail: typeof p.showEmail === 'boolean' ? p.showEmail : DEFAULT_PREFS.showEmail,
  };
}

export function resolveSurface(id: SurfaceId): SurfaceDef {
  if (id === 'system') {
    const dark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return SURFACES.find((s) => s.id === (dark ? 'midnight' : 'white'))!;
  }
  return SURFACES.find((s) => s.id === id) ?? SURFACES[0];
}

export function applyTheme(prefs: Prefs): void {
  const root = document.documentElement;
  const surface = resolveSurface(prefs.surface);
  const accentDef = ACCENTS.find((a) => a.id === prefs.accent) ?? ACCENTS[3];
  const v = surface.vars;

  const set = (name: string, value: string) => root.style.setProperty(`--${name}`, value);
  for (const [k, val] of Object.entries(v)) set(k, val);

  // Fill colour for buttons and highlights: the accent itself, nudged only if it would vanish into the page.
  const fill = ensureContrast(accentDef.hex, v.panel, 3);
  set('accent', fill);
  set('accent-ink', inkOn(fill));
  // Text-weight use of the accent (links, small labels) must clear 4.5:1.
  set('accent-text', ensureContrast(accentDef.hex, v.panel, 4.5));
  set('accent-hover', shiftLightness(fill, surface.dark ? 0.06 : -0.06));

  root.dataset.surface = surface.id;
  root.dataset.dark = String(surface.dark);
  root.dataset.density = prefs.density;
  root.style.colorScheme = surface.dark ? 'dark' : 'light';
  root.style.fontSize = prefs.fontSize === 'sm' ? '14.5px' : prefs.fontSize === 'lg' ? '17.5px' : '16px';

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', v.bg);
}

/** Re-applies the theme when the device switches between light and dark, if the user follows the device. */
export function watchSystem(getPrefs: () => Prefs): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => { if (getPrefs().surface === 'system') applyTheme(getPrefs()); };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
