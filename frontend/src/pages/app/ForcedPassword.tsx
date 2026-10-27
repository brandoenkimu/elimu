import { useState, type FormEvent } from 'react';
import { Mark } from '../../components/icons';
import { Button, Notice, PasswordField } from '../../components/ui';
import { api } from '../../lib/singletons';
import { errorText } from '../../lib/useApi';
import { passwordValid } from '../../lib/validators';
import { useSession } from '../../state/session';

/** Shown instead of the app when an administrator issued a temporary password. */
export default function ForcedPassword() {
  const { user, setUser, logout } = useSession();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!current) return setError('Enter the temporary password you were given.');
    if (!passwordValid(pw)) return setError('Choose a password that meets all three rules.');
    if (pw !== confirm) return setError('The two new passwords do not match.');
    setBusy(true); setError(null);
    try {
      const session = await api.changePassword({ currentPassword: current, newPassword: pw, confirmPassword: confirm });
      setUser(session.user);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  return (
    <div className="splash">
      <Mark size={46} />
      <div className="card" style={{ width: 'min(440px, 100%)', textAlign: 'left' }}>
        <h1 style={{ fontSize: '1.6rem' }}>Choose your own password</h1>
        <p className="muted" style={{ margin: '8px 0 18px' }}>Hello {user?.displayName.split(' ')[0]}. Your account was created with a temporary password. Set a new one to continue.</p>
        <form className="stack" onSubmit={submit} noValidate>
          {error && <Notice tone="warn">{error}</Notice>}
          <PasswordField label="Temporary password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <PasswordField label="New password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} showStrength />
          <PasswordField label="Confirm new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} matchWith={pw} />
          <Button kind="primary" type="submit" busy={busy}>Save and continue</Button>
          <button type="button" className="link" onClick={() => void logout()} style={{ justifySelf: 'center' }}>Sign out instead</button>
        </form>
      </div>
    </div>
  );
}
