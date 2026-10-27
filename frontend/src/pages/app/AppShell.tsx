import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, LinkPill } from '../../components/bits';
import {
  ActivityIcon, AwardIcon, BellIcon, BookIcon, BuildingIcon, CalendarIcon, CapIcon, ChartIcon, ChatIcon, CheckIcon,
  CloseIcon, GearIcon, HomeIcon, LayersIcon, LogoutIcon, MenuIcon, UserCheckIcon, UsersIcon, FileIcon,
} from '../../components/icons';
import { ThemeMenu } from '../../components/ThemeMenu';
import { Button, Loading } from '../../components/ui';
import { cx, relative, roleLabel } from '../../lib/format';
import type { Role } from '../../lib/types';
import { ChatProvider, useChat } from '../../state/chat';
import { NotificationsProvider, useNotifications } from '../../state/notifications';
import { useSession } from '../../state/session';
import { Brand } from '../public/Landing';
import { Mark } from '../../components/icons';
import ForcedPassword from './ForcedPassword';

interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean; badge?: number }

function navFor(role: Role, unreadChats: number): { heading?: string; items: NavItem[] }[] {
  if (role === 'admin') {
    return [
      { items: [{ to: '/app', label: 'Overview', icon: <HomeIcon />, end: true }] },
      {
        heading: 'People',
        items: [{ to: '/app/admin/users', label: 'Users', icon: <UsersIcon /> }, { to: '/app/admin/approvals', label: 'Approvals', icon: <UserCheckIcon /> }],
      },
      {
        heading: 'Academics',
        items: [
          { to: '/app/admin/courses', label: 'Courses and units', icon: <BookIcon /> },
          { to: '/app/admin/terms', label: 'Semesters', icon: <CalendarIcon /> },
          { to: '/app/admin/classes', label: 'Classes', icon: <LayersIcon /> },
        ],
      },
      {
        heading: 'Institution',
        items: [
          { to: '/app/admin/reports', label: 'Reports', icon: <FileIcon /> },
          { to: '/app/admin/audit', label: 'Activity log', icon: <ActivityIcon /> },
          { to: '/app/admin/system', label: 'System', icon: <BuildingIcon /> },
        ],
      },
      { items: [{ to: '/app/settings', label: 'Settings', icon: <GearIcon /> }] },
    ];
  }
  const common: NavItem[] = [
    { to: '/app', label: 'Home', icon: <HomeIcon />, end: true },
    { to: '/app/messages', label: 'Messages', icon: <ChatIcon />, badge: unreadChats },
    { to: '/app/people', label: 'People', icon: <UsersIcon /> },
    { to: '/app/classes', label: role === 'student' ? 'My units' : 'My classes', icon: <BookIcon /> },
  ];
  if (role === 'student') {
    common.push({ to: '/app/registration', label: 'Unit registration', icon: <CapIcon /> }, { to: '/app/grades', label: 'My results', icon: <AwardIcon /> });
  } else {
    common.push({ to: '/app/gradebooks', label: 'Gradebooks', icon: <ChartIcon /> });
  }
  return [{ items: common }, { items: [{ to: '/app/settings', label: 'Settings', icon: <GearIcon /> }] }];
}

function Bell() {
  const { items, unread, markAllRead, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="theme-menu" ref={box}>
      <button type="button" className={cx('btn icon bell', open && 'on')} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <BellIcon />{unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="popover notif" role="dialog" aria-label="Notifications">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <p className="pop-title">Notifications</p>
            {unread > 0 && <button type="button" className="link" style={{ fontSize: '.82rem' }} onClick={markAllRead}>Mark all read</button>}
          </div>
          {items.length === 0 ? <p className="muted" style={{ padding: '14px 0' }}>You are all caught up.</p> : (
            <ul className="notif-list">
              {items.slice(0, 12).map((n) => (
                <li key={n.id}>
                  <button type="button" className={cx('notif-item', !n.readAt && 'unread')} onClick={() => { markRead(n.id); setOpen(false); if (n.data.link) nav(n.data.link); }}>
                    <b>{n.title}</b>
                    {n.body && <span>{n.body}</span>}
                    <time>{relative(n.createdAt)}</time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  if (!user) return null;
  return (
    <div className="theme-menu" ref={box}>
      <button type="button" className="user-btn" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Avatar name={user.displayName} size={34} />
      </button>
      {open && (
        <div className="popover user-pop" role="menu">
          <div className="who"><Avatar name={user.displayName} size={42} /><div><b>{user.displayName}</b><span>{roleLabel(user.role)}</span></div></div>
          <hr className="divider" />
          <Link role="menuitem" to="/app/settings/profile" onClick={() => setOpen(false)}>Profile and settings</Link>
          <Link role="menuitem" to="/app/settings/security" onClick={() => setOpen(false)}>Password and security</Link>
          <hr className="divider" />
          <button role="menuitem" type="button" onClick={() => void logout()}><LogoutIcon width={16} height={16} /> Sign out</button>
        </div>
      )}
    </div>
  );
}

function Frame() {
  const { user, prefs } = useSession();
  const chat = useChat();
  const loc = useLocation();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [loc.pathname]);
  if (!user) return null;
  const groups = navFor(user.role, chat.totalUnread);
  const showNode = user.role === 'admin' || prefs.showServerDetails;
  const full = loc.pathname.startsWith('/app/messages');

  return (
    <div className={cx('shell', drawer && 'drawer-open')}>
      <a className="skip" href="#content">Skip to content</a>
      <aside className="rail" aria-label="Main">
        <div className="rail-head">
          <Brand to="/app" />
          <button type="button" className="btn icon rail-close" onClick={() => setDrawer(false)} aria-label="Close menu"><CloseIcon /></button>
        </div>
        <nav className="rail-nav">
          {groups.map((g, i) => (
            <div key={i} className="rail-group">
              {g.heading && <p className="rail-heading">{g.heading}</p>}
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => cx('rail-link', isActive && 'active')}>
                  {it.icon}<span>{it.label}</span>
                  {it.badge ? <span className="badge">{it.badge > 99 ? '99+' : it.badge}</span> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="rail-foot">
          <Link to="/app/settings/profile" className="me-card">
            <Avatar name={user.displayName} size={38} />
            <span><b>{user.displayName}</b><small>{roleLabel(user.role)}{user.role === 'student' && user.regNumber ? ` · ${user.regNumber}` : user.role === 'lecturer' && user.staffNumber ? ` · ${user.staffNumber}` : ''}</small></span>
          </Link>
        </div>
      </aside>
      {drawer && <button type="button" className="scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />}

      <div className="stage">
        <header className="topbar">
          <button type="button" className="btn icon menu-btn" onClick={() => setDrawer(true)} aria-label="Open menu"><MenuIcon /></button>
          <span className="top-brand"><Mark size={28} /></span>
          <span className="spacer" />
          <LinkPill state={chat.link.state} node={chat.link.node} showNode={showNode} />
          <ThemeMenu />
          <Bell />
          <UserMenu />
        </header>
        <main id="content" className={cx('content', full && 'content-full')} tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Everything under /app: sign-in required, forced password change handled, providers mounted. */
export default function AppShell() {
  const { status, user, retry } = useSession();
  const loc = useLocation();

  if (status === 'loading') return <div className="splash"><Mark size={46} /><Loading label="Opening Elimu…" /></div>;
  if (status === 'unreachable') {
    return (
      <div className="splash">
        <Mark size={46} />
        <h1>We can’t reach Elimu right now</h1>
        <p className="muted">Check your internet connection and try again. If it keeps happening, the service may be briefly down.</p>
        <Button kind="primary" onClick={retry}>Try again</Button>
      </div>
    );
  }
  if (status !== 'authed' || !user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (user.mustChangePassword) return <ForcedPassword />;

  return (
    <NotificationsProvider>
      <ChatProvider>
        <Frame />
      </ChatProvider>
    </NotificationsProvider>
  );
}

export { CheckIcon };
