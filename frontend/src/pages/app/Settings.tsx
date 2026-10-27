import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AccentDots, SurfaceSwatches } from '../../components/ThemeMenu';
import { LockIcon, PaletteIcon, ShieldIcon, UsersIcon } from '../../components/icons';
import { Button, Card, Confirm, PageHeader, PasswordField, Notice, Segmented, SelectField, TextArea, TextField, Toggle } from '../../components/ui';
import { NAME_RE, passwordValid } from '../../lib/validators';
import { api } from '../../lib/singletons';
import { roleLabel } from '../../lib/format';
import { errorText, fieldErrors, useGet } from '../../lib/useApi';
import { useSession } from '../../state/session';
import { useToast } from '../../state/toast';

type PublicCourse = { id: string; code: string; name: string; department: string; durationYears: number };

function ProfilePane() {
  const { user, setUser } = useSession();
  const toast = useToast();
  const u = user!;
  const isLecturer = u.role === 'lecturer';
  const isStudent = u.role === 'student';
  const courses = useGet<{ courses: PublicCourse[] }>(isStudent ? '/catalog/courses' : null);
  const [f, setF] = useState({ displayName: u.displayName, phone: u.phone ?? '', bio: u.bio, title: u.title ?? '', department: u.department ?? '', office: u.office ?? '', officeHours: u.officeHours ?? '', courseId: u.courseId ?? '', yearOfStudy: String(u.yearOfStudy ?? 1) });
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const course = courses.data?.courses.find((c) => c.id === f.courseId);
  const years = course?.durationYears ?? 7;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!NAME_RE.test(f.displayName) || f.displayName.trim().length < 2) local.displayName = "Use at least 2 letters. Letters, numbers, spaces and . ' - only.";
    if (Object.keys(local).length) return setErrs(local);
    setBusy(true); setErrs({});
    try {
      const body: Record<string, unknown> = { displayName: f.displayName.trim(), phone: f.phone.trim(), bio: f.bio };
      if (isLecturer) Object.assign(body, { title: f.title.trim(), department: f.department.trim(), office: f.office.trim(), officeHours: f.officeHours.trim() });
      if (isStudent && f.courseId) Object.assign(body, { courseId: f.courseId, yearOfStudy: Number(f.yearOfStudy) });
      const r = await api.put<{ user: typeof u }>('/profile', body);
      setUser(r.user); toast.show('Profile saved.', 'good');
    } catch (err) { setErrs(fieldErrors(err)); toast.show(errorText(err), 'bad'); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={save} className="stack">
      <Card className="stack">
        <h3>{isLecturer ? 'Lecturer profile' : isStudent ? 'Student profile' : 'Administrator profile'}</h3>
        <div className="form-grid">
          <TextField label="Full name" value={f.displayName} onChange={set('displayName')} error={errs.displayName} />
          <TextField label="Email" value={u.email} disabled hint="Your sign-in email. Ask an administrator to change it." />
          {isStudent && <TextField label="Registration number" value={u.regNumber ?? ''} disabled hint="Issued by the institution, so it can only be changed by an administrator." />}
          {isLecturer && <TextField label="Staff number" value={u.staffNumber ?? ''} disabled hint="Issued by the institution." />}
          <TextField label="Phone" optional value={f.phone} onChange={set('phone')} error={errs.phone} autoComplete="tel" />
        </div>
        {isStudent && (
          <div className="form-grid">
            <SelectField label="Course" value={f.courseId} onChange={set('courseId')} error={errs.courseId}>
              <option value="">Choose your course…</option>
              {(courses.data?.courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </SelectField>
            <SelectField label="Year of study" value={f.yearOfStudy} onChange={set('yearOfStudy')} error={errs.yearOfStudy}>
              {Array.from({ length: years }, (_, i) => <option key={i + 1} value={i + 1}>Year {i + 1}</option>)}
            </SelectField>
          </div>
        )}
        {isLecturer && (
          <div className="form-grid">
            <TextField label="Title" optional placeholder="Dr., Prof., Mr., Ms." value={f.title} onChange={set('title')} maxLength={24} />
            <TextField label="Department" value={f.department} onChange={set('department')} error={errs.department} />
            <TextField label="Office" optional value={f.office} onChange={set('office')} />
            <TextField label="Office hours" optional placeholder="e.g. Tue and Thu, 2 to 4 pm" value={f.officeHours} onChange={set('officeHours')} />
          </div>
        )}
        <TextArea label={isLecturer ? 'About you' : 'Bio'} optional rows={3} value={f.bio} onChange={set('bio')} maxLength={500} hint={isLecturer ? 'Research interests, how students can reach you.' : 'A line or two about you.'} />
        <div><Button type="submit" kind="primary" busy={busy}>Save profile</Button></div>
      </Card>
      <Card><dl className="facts"><dt>Account type</dt><dd>{roleLabel(u.role)}</dd>{u.lastLoginAt && <><dt>Last sign-in</dt><dd>{new Date(u.lastLoginAt).toLocaleString()}</dd></>}</dl></Card>
    </form>
  );
}

function AppearancePane() {
  const { prefs, updatePrefs } = useSession();
  return (
    <div className="stack">
      <Card className="stack"><h3>Background</h3><SurfaceSwatches /></Card>
      <Card className="stack"><h3>Accent colour</h3><AccentDots /></Card>
      <Card className="stack">
        <h3>Reading comfort</h3>
        <Segmented label="Text size" value={prefs.fontSize} onChange={(v) => updatePrefs({ fontSize: v })} options={[{ value: 'sm', label: 'Smaller' }, { value: 'md', label: 'Default' }, { value: 'lg', label: 'Larger' }]} />
        <Segmented label="Spacing" value={prefs.density} onChange={(v) => updatePrefs({ density: v })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
        <small className="muted">Changes apply immediately and follow you to other devices.</small>
      </Card>
    </div>
  );
}

function SecurityPane() {
  const { logoutEverywhere, setUser } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [conf, setConf] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cur) return setErr('Enter your current password.');
    if (!passwordValid(pw)) return setErr('Choose a password that meets all three rules.');
    if (pw !== conf) return setErr('The two new passwords do not match.');
    setBusy(true); setErr(null);
    try { const s = await api.changePassword({ currentPassword: cur, newPassword: pw, confirmPassword: conf }); setUser(s.user); setCur(''); setPw(''); setConf(''); toast.show('Password changed. Other devices were signed out.', 'good'); }
    catch (e2) { setErr(errorText(e2)); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <Card>
        <form onSubmit={submit} className="stack">
          <h3>Change password</h3>
          <PasswordField label="Current password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
          <PasswordField label="New password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} showStrength />
          <PasswordField label="Confirm new password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} matchWith={pw} />
          {err && <div className="alert alert-bad" role="alert">{err}</div>}
          <div><Button type="submit" kind="primary" busy={busy}>Update password</Button></div>
        </form>
      </Card>
      <Card className="stack">
        <h3>Signed in somewhere you do not recognise?</h3>
        <p className="muted">Sign out of every device, including this one. Do this if you used a shared computer or think someone knows your password.</p>
        <div><Button kind="danger" onClick={() => setAsk(true)}>Sign out everywhere</Button></div>
      </Card>
      <Notice>Forgot your password? Sign out and use “Forgot password” on the sign-in page. A reset link is emailed to you.</Notice>
      <Confirm open={ask} title="Sign out on all devices?" danger confirmLabel="Sign out everywhere" onConfirm={async () => { await logoutEverywhere(); nav('/login'); }} onClose={() => setAsk(false)}>You will need to sign in again.</Confirm>
    </div>
  );
}

function PrivacyPane() {
  const { prefs, updatePrefs, user } = useSession();
  return (
    <div className="stack">
      <Card className="stack">
        <h3>Who can reach you</h3>
        <Toggle checked={prefs.allowRequests} onChange={(v) => updatePrefs({ allowRequests: v })} label="Allow connection requests" hint="Turn off to stop new students sending you requests. Existing connections are unaffected." />
        <Toggle checked={prefs.showEmail} onChange={(v) => updatePrefs({ showEmail: v })} label="Show my email on my profile" hint={user!.role === 'lecturer' ? 'Students can always message you in Elimu.' : 'Hidden by default.'} />
      </Card>
      <Card className="stack">
        <h3>Advanced</h3>
        <Toggle checked={prefs.showServerDetails} onChange={(v) => updatePrefs({ showServerDetails: v })} label="Show connection details" hint="Shows which server you are connected to. Useful when reporting a problem." />
      </Card>
    </div>
  );
}

export default function Settings() {
  useEffect(() => { document.title = 'Settings · Elimu'; }, []);
  const items = [{ to: 'profile', label: 'Profile', icon: <UsersIcon /> }, { to: 'appearance', label: 'Appearance', icon: <PaletteIcon /> }, { to: 'security', label: 'Password and security', icon: <LockIcon /> }, { to: 'privacy', label: 'Privacy', icon: <ShieldIcon /> }];
  return (
    <>
      <PageHeader title="Settings" />
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {items.map((i) => <NavLink key={i.to} to={`/app/settings/${i.to}`} className={({ isActive }) => (isActive ? 'on' : '')}>{i.icon}<span>{i.label}</span></NavLink>)}
        </nav>
        <div className="settings-body">
          <Routes>
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<ProfilePane />} />
            <Route path="appearance" element={<AppearancePane />} />
            <Route path="security" element={<SecurityPane />} />
            <Route path="privacy" element={<PrivacyPane />} />
            <Route path="*" element={<Navigate to="profile" replace />} />
          </Routes>
        </div>
      </div>
    </>
  );
}
