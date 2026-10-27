import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const base = (props: P): P => ({
  width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...props,
});

const icon = (...paths: string[]) => (p: P) => (
  <svg {...base(p)}>{paths.map((d, i) => <path key={i} d={d} />)}</svg>
);

export const ReplyIcon = icon('M9 14 4 9l5-5', 'M4 9h10a6 6 0 0 1 6 6v3');
export const SmileIcon = icon('M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z', 'M8.5 14a4.5 4.5 0 0 0 7 0', 'M9 9.5h.01', 'M15 9.5h.01');
export const SendIcon = icon('M4 12 20 4l-5 16-3.2-6.8L4 12Z', 'm11.8 13.2 8.2-9.2');
export const PlusIcon = icon('M12 5v14M5 12h14');
export const BackIcon = icon('m14 6-6 6 6 6');
export const CloseIcon = icon('m6 6 12 12M18 6 6 18');
export const CheckIcon = icon('m5 12.5 4.5 4.5L19 7.5');
export const ChevronDown = icon('m6 9 6 6 6-6');
export const ChevronRight = icon('m9 6 6 6-6 6');
export const InfoIcon = icon('M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z', 'M12 11v5M12 8h.01');
export const LogoutIcon = icon('M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4', 'm15 8 4 4-4 4M19 12H9');
export const HomeIcon = icon('M4 11 12 4l8 7', 'M6 10v9h12v-9', 'M10 19v-5h4v5');
export const ChatIcon = icon('M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z');
export const UsersIcon = icon('M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M2.5 19.5c.5-3.3 3.2-5 6.5-5s6 1.7 6.5 5', 'M16 4.4a3.2 3.2 0 0 1 0 6.2', 'M17.5 14.7c2.2.4 3.7 1.9 4 4.3');
export const BookIcon = icon('M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5Z', 'M5 17a3 3 0 0 1 3-3h10');
export const ClipboardIcon = icon('M9 4h6v3H9z', 'M7 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-1', 'M8.5 12h7M8.5 16h5');
export const PinIcon = icon('M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21Z', 'M12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z');
export const ChartIcon = icon('M4 20V5', 'M4 20h16', 'M8 16v-4M12 16V8M16 16v-6');
export const GearIcon = icon('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z');
export const BellIcon = icon('M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15L6 16.5Z', 'M10 21a2 2 0 0 0 4 0');
export const EyeIcon = icon('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z', 'M12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z');
export const EyeOffIcon = icon('M3 3l18 18', 'M10.6 5.7A9.5 9.5 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15 15 0 0 1-2.8 3.6', 'M6.6 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.4 3.8-.9', 'M9.9 9.9a2.8 2.8 0 0 0 4.2 3.7');
export const SearchIcon = icon('M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm20 20-4.2-4.2');
export const ShieldIcon = icon('M12 3 5 6v5.5c0 4.4 2.9 7.7 7 9.5 4.1-1.8 7-5.1 7-9.5V6l-7-3Z', 'm9 12 2.2 2.2L15.5 10');
export const CapIcon = icon('m2.5 9.5 9.5-4.5 9.5 4.5L12 14 2.5 9.5Z', 'M6.5 11.7V16c0 1.2 2.5 2.5 5.5 2.5s5.5-1.3 5.5-2.5v-4.3', 'M21.5 9.5V15');
export const BuildingIcon = icon('M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16', 'M15 10h3a1 1 0 0 1 1 1v10', 'M3 21h18', 'M8.5 8h3M8.5 12h3M8.5 16h3');
export const CalendarIcon = icon('M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z', 'M4 10.5h16M8 4v4M16 4v4');
export const UploadIcon = icon('M12 16V4', 'm7 9 5-5 5 5', 'M5 20h14');
export const DownloadIcon = icon('M12 4v12', 'm7 11 5 5 5-5', 'M5 20h14');
export const PrintIcon = icon('M7 9V4h10v5', 'M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2', 'M7 14h10v6H7z');
export const TrashIcon = icon('M4.5 7h15', 'M9.5 7V4.5h5V7', 'M6.5 7l.8 12.5h9.4L17.5 7', 'M10 11v5M14 11v5');
export const EditIcon = icon('M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z', 'm13.5 6.5 4 4');
export const LockIcon = icon('M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z', 'M8 11V8a4 4 0 0 1 8 0v3');
export const MailIcon = icon('M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z', 'm3.5 7.5 8.5 6 8.5-6');
export const PaletteIcon = icon('M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.9 1.8-1.8 0-1.5-1.5-1.7-1.5-3 0-.9.8-1.7 1.7-1.7H16a4.5 4.5 0 0 0 4.5-4.5C20.5 6.2 16.8 3.5 12 3.5Z', 'M7.5 11h.01M10 7.5h.01M14.5 7.5h.01');
export const MenuIcon = icon('M4 7h16M4 12h16M4 17h16');
export const AwardIcon = icon('M12 14a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Z', 'm8.5 13.5-1.5 7 5-2.5 5 2.5-1.5-7');
export const UserPlusIcon = icon('M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M2.5 19.5c.5-3.3 3.2-5 6.5-5 1.6 0 3 .4 4.2 1.1', 'M18 14v6M15 17h6');
export const UserCheckIcon = icon('M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M2.5 19.5c.5-3.3 3.2-5 6.5-5 1.6 0 3 .4 4.2 1.1', 'm15.5 18 2 2 3.5-4');
export const ActivityIcon = icon('M3 12h4l2.5-7 5 14 2.5-7H21');
export const LayersIcon = icon('m12 3.5 9 4.5-9 4.5L3 8l9-4.5Z', 'm3 12.5 9 4.5 9-4.5', 'm3 16.5 9 4.5 9-4.5');
export const TimerIcon = icon('M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M12 9v4l2.5 1.5', 'M9.5 2.5h5');
export const FileIcon = icon('M7 3.5h7l5 5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z', 'M14 3.5V9h5');
export const MegaphoneIcon = icon('M4 13v-2a1 1 0 0 1 1-1h3l8-4v12l-8-4H5a1 1 0 0 1-1-1Z', 'M8 15l1 5h2.5l-1-4.5');
export const StarIcon = icon('m12 3.5 2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.9l6-.9L12 3.5Z');
export const CopyIcon = icon('M10 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z', 'M5 15V5.5a1 1 0 0 1 1-1H15');
export const SunIcon = icon('M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4');
export const ClockIcon = icon('M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z', 'M12 7.5V12l3 2');
export const BanIcon = icon('M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z', 'm6 6 12 12');
export const ArrowRight = icon('M5 12h14', 'm13 6 6 6-6 6');
export const KeyIcon = icon('M8 15a4 4 0 1 1 3.9-4.9H21v3h-2.5v2.5H16V13h-4.1A4 4 0 0 1 8 15Z');

/** Elimu mark: an open book whose pages rise like a sunrise. */
export const Mark = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="var(--accent)" />
    <g fill="none" stroke="var(--accent-ink)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 21.5c3.3-1.7 6.7-1.7 9.5.5 2.8-2.2 6.2-2.2 9.5-.5" />
      <path d="M6.5 21.5V12.5c3.3-1.7 6.7-1.7 9.5.5v8.5M25.5 21.5V12.5c-3.3-1.7-6.7-1.7-9.5.5" />
    </g>
    <circle cx="16" cy="8.3" r="2" fill="var(--accent-ink)" />
  </svg>
);
