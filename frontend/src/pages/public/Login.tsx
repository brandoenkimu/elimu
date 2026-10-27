import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, Check, Notice, PasswordField, TextField } from '../../components/ui';
import { errorText } from '../../lib/useApi';
import { EMAIL_RE } from '../../lib/validators';
import { useSession } from '../../state/session';
import { AuthLayout } from './AuthLayout';

export default function Login() {
  const { status, login } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/app';
  const flash = (loc.state as { flash?: string } | null)?.flash;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  if (status === 'authed') return <Navigate to={from} replace />;

  const emailErr = touched && !EMAIL_RE.test(email.trim()) ? 'Enter the email address you signed up with.' : null;
  const pwErr = touched && !password ? 'Enter your password.' : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!EMAIL_RE.test(email.trim()) || !password) return;
    setBusy(true);
    try {
      await login(email.trim().toLowerCase(), password, remember);
      nav(from, { replace: true });
    } catch (err) {
      setError(errorText(err, 'We could not sign you in. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      side={{
        title: 'Good to see you again.',
        body: 'Your classes, conversations and coursework are right where you left them.',
        points: ['Pick up your class chats', 'Check deadlines and new marks', 'Mark your attendance in seconds'],
      }}
    >
      <h1>Welcome back</h1>
      <p className="lede">Sign in to continue to Elimu.</p>
      {flash && <div style={{ marginBottom: 16 }}><Notice tone="good">{flash}</Notice></div>}
      <form className="auth-form" onSubmit={submit} noValidate>
        {error && <Notice tone="warn">{error}</Notice>}
        <TextField label="Email address" type="email" autoComplete="username" inputMode="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} error={emailErr} placeholder="you@university.ac.ke" />
        <PasswordField label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={pwErr} placeholder="Your password" />
        <div className="auth-row">
          <Check checked={remember} onChange={setRemember}>Keep me signed in</Check>
          <Link to="/forgot" state={{ email }} className="link">Forgot password?</Link>
        </div>
        <Button kind="primary" type="submit" busy={busy}>Sign in</Button>
      </form>
      <p className="auth-alt">New to Elimu? <Link to="/register">Create an account</Link></p>
    </AuthLayout>
  );
}
