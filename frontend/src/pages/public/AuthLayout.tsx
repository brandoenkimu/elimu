import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BackIcon, CheckIcon } from '../../components/icons';
import { ThemeMenu } from '../../components/ThemeMenu';
import { Brand } from './Landing';

export interface SideCopy { title: string; body: string; points: string[]; quote?: string }

export function AuthLayout({ side, children, wide }: { side: SideCopy; children: ReactNode; wide?: boolean }) {
  return (
    <div className="auth">
      <aside className="auth-side">
        <Brand />
        <div className="auth-copy">
          <h2>{side.title}</h2>
          <p>{side.body}</p>
          <ul className="auth-points">
            {side.points.map((p) => (<li key={p}><CheckIcon /> {p}</li>))}
          </ul>
        </div>
        <p className="auth-quote">{side.quote ?? '“Education is the most powerful weapon which you can use to change the world.” — Nelson Mandela'}</p>
      </aside>
      <div className="auth-main">
        <div className="auth-top">
          <Brand />
          <Link className="back-home" to="/"><BackIcon width={16} height={16} /> Home</Link>
          <ThemeMenu />
        </div>
        <div className="auth-center">
          <div className={wide ? 'auth-card wide' : 'auth-card'}>{children}</div>
        </div>
      </div>
    </div>
  );
}
