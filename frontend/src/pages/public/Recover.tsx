import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { MailIcon } from '../../components/icons';
import { Button, Notice, PasswordField, TextField } from '../../components/ui';
import { api } from '../../lib/singletons';
import { errorText } from '../../lib/useApi';
import { EMAIL_RE, passwordValid } from '../../lib/validators';
import { AuthLayout } from './AuthLayout';

const SIDE = { title: 'Locked out? It happens.', body: 'We will help you get back in, safely.', points: ['A one-time link, valid for 30 minutes', 'Other devices are signed out after a reset'] };

export function Forgot() {
  const loc = useLocation();
  const [email, setEmail] = useState((loc.state as { email?: string } | null)?.email ?? '');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) { setError('Enter the email address you signed up with.'); return; }
    setBusy(true); setError(null);
    try { await api.forgot(email.trim().toLowerCase()); setSent(true); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  return (
    <AuthLayout side={SIDE}>
      {sent ? (
        <div className="auth-done">
          <span className="big"><MailIcon /></span>
          <h1>Check your email</h1>
          <p className="muted">If <b>{email}</b> belongs to an account, a reset link is on its way. It expires in 30 minutes.</p>
          <Link className="btn primary" to="/login">Back to sign in</Link>
        </div>
      ) : (
        <>
          <h1>Reset your password</h1>
          <p className="lede">Enter your email and we will send you a link to choose a new password.</p>
          <form className="auth-form" onSubmit={submit} noValidate>
            {error && <Notice tone="warn">{error}</Notice>}
            <TextField label="Email address" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@university.ac.ke" />
            <Button kind="primary" type="submit" busy={busy}>Send reset link</Button>
          </form>
          <p className="auth-alt"><Link to="/login">Back to sign in</Link></p>
        </>
      )}
    </AuthLayout>
  );
}

export function Reset() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!passwordValid(pw)) { setError('Choose a password that meets all three rules.'); return; }
    if (pw !== confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true); setError(null);
    try {
      await api.reset({ token, password: pw, confirmPassword: confirm });
      nav('/login', { replace: true, state: { flash: 'Your password has been changed. Sign in with the new one.' } });
    } catch (err) { setError(errorText(err, 'This link is invalid or has expired. Request a new one.')); }
    finally { setBusy(false); }
  }

  if (!token) {
    return (
      <AuthLayout side={SIDE}>
        <h1>This link is not valid</h1>
        <p className="lede">Open the link from your email again, or request a new one.</p>
        <Link className="btn primary" to="/forgot">Request a new link</Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout side={SIDE}>
      <h1>Choose a new password</h1>
      <p className="lede">Pick something you have not used elsewhere.</p>
      <form className="auth-form" onSubmit={submit} noValidate>
        {error && <Notice tone="warn">{error}</Notice>}
        <PasswordField label="New password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} showStrength autoFocus />
        <PasswordField label="Confirm new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} matchWith={pw} />
        <Button kind="primary" type="submit" busy={busy}>Change password</Button>
      </form>
    </AuthLayout>
  );
}
