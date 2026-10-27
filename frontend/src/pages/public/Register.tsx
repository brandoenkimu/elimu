import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { CapIcon, CheckIcon, UsersIcon } from '../../components/icons';
import { Button, Check, Notice, PasswordField, SelectField, TextField } from '../../components/ui';
import { api } from '../../lib/singletons';
import { errorText, fieldErrors } from '../../lib/useApi';
import { EMAIL_RE, ID_RE, NAME_RE, passwordValid } from '../../lib/validators';
import { useSession } from '../../state/session';
import { AuthLayout } from './AuthLayout';

type RoleChoice = 'student' | 'lecturer';
type Course = { id: string; code: string; name: string; department: string; durationYears: number; semestersPerYear: number };

export default function Register() {
  const { status, register } = useSession();
  const nav = useNavigate();
  const [role, setRole] = useState<RoleChoice>('student');
  const [courses, setCourses] = useState<Course[]>([]);
  const [v, setV] = useState({ name: '', email: '', idNumber: '', courseId: '', year: '1', department: '', title: 'Dr.', password: '', confirm: '', agree: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => { api.publicCourses().then((r) => setCourses(r.courses), () => undefined); }, []);
  const course = useMemo(() => courses.find((c) => c.id === v.courseId), [courses, v.courseId]);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => { setV((s) => ({ ...s, [k]: val })); if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };

  if (status === 'authed') return <Navigate to="/app" replace />;

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (v.name.trim().length < 2 || !NAME_RE.test(v.name.trim())) e.name = 'Enter your full name (letters, spaces, . \' -).';
    if (!EMAIL_RE.test(v.email.trim())) e.email = 'Enter a valid email address.';
    if (!ID_RE.test(v.idNumber.trim())) e.idNumber = role === 'student' ? 'Enter your registration number, for example SC211/0123/2025.' : 'Enter your staff number.';
    if (role === 'student' && !v.courseId) e.courseId = 'Choose the course you are studying.';
    if (role === 'lecturer' && v.department.trim().length < 2) e.department = 'Enter your department.';
    if (!passwordValid(v.password)) e.password = 'Choose a password that meets all three rules below.';
    if (v.confirm !== v.password) e.confirm = 'The two passwords do not match.';
    if (!v.agree) e.agree = 'Please confirm to continue.';
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const base = { displayName: v.name.trim().replace(/\s+/g, ' '), email: v.email.trim().toLowerCase(), password: v.password, confirmPassword: v.confirm };
      const payload = role === 'student'
        ? { ...base, role, regNumber: v.idNumber.trim().toUpperCase(), courseId: v.courseId, yearOfStudy: Number(v.year) }
        : { ...base, role, staffNumber: v.idNumber.trim().toUpperCase(), department: v.department.trim(), title: v.title };
      const result = await register(payload);
      if (result === 'pending') setPending(true);
      else nav('/app/registration', { replace: true, state: { welcome: true } });
    } catch (err) {
      const f = fieldErrors(err);
      const mapped: Record<string, string> = {};
      if (f.email) mapped.email = f.email;
      if (f.regNumber || f.staffNumber) mapped.idNumber = f.regNumber ?? f.staffNumber;
      if (f.displayName) mapped.name = f.displayName;
      if (f.password) mapped.password = f.password;
      if (f.confirmPassword) mapped.confirm = f.confirmPassword;
      if (f.courseId) mapped.courseId = f.courseId;
      if (f.department) mapped.department = f.department;
      setErrors(mapped);
      const msg = errorText(err, 'We could not create your account. Please try again.');
      const code = (err as { code?: string }).code;
      if (code === 'EMAIL_TAKEN') setErrors({ email: msg });
      else if (code === 'REG_NUMBER_TAKEN' || code === 'STAFF_NUMBER_TAKEN') setErrors({ idNumber: msg });
      else if (!Object.keys(mapped).length) setFormError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <AuthLayout side={{ title: 'Thank you for joining.', body: 'An administrator will check your details and activate your lecturer account.', points: ['You will get an email when you are approved', 'Then sign in and set up your classes'] }}>
        <div className="auth-done">
          <span className="big"><CheckIcon /></span>
          <h1>Request received</h1>
          <p className="muted">Your lecturer account is waiting for approval. This usually takes a short while. You can sign in once it is approved.</p>
          <Link className="btn primary" to="/login">Back to sign in</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      wide
      side={{
        title: role === 'student' ? 'Start your semester well.' : 'Bring your classes online.',
        body: role === 'student' ? 'Create your account, choose your course and register your units. Your class groups are waiting.' : 'Create your lecturer account to run class groups, set coursework and mark with confidence.',
        points: role === 'student' ? ['Register your units in minutes', 'Join class chats automatically', 'Track your marks and attendance'] : ['Class lists, ready to print', 'Online exams with auto-marking', 'You decide when marks are released'],
      }}
    >
      <h1>Create your account</h1>
      <p className="lede">Tell us who you are and we will set up the right space for you.</p>

      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="role-pick" role="radiogroup" aria-label="I am a">
          <button type="button" role="radio" aria-checked={role === 'student'} className="role-card" onClick={() => setRole('student')}>
            <span className="ic"><CapIcon /></span><span><b>Student</b><span className="sub">I am studying a course</span></span>
          </button>
          <button type="button" role="radio" aria-checked={role === 'lecturer'} className="role-card" onClick={() => setRole('lecturer')}>
            <span className="ic"><UsersIcon /></span><span><b>Lecturer</b><span className="sub">I teach units</span></span>
          </button>
        </div>

        {formError && <Notice tone="warn">{formError}</Notice>}

        <div className="form-grid">
          <div className="full"><TextField label="Full name" autoComplete="name" value={v.name} onChange={(e) => set('name', e.target.value)} error={errors.name} placeholder="As it appears on your ID" /></div>
          <div className="full"><TextField label="Email address" type="email" autoComplete="email" inputMode="email" value={v.email} onChange={(e) => set('email', e.target.value)} error={errors.email} placeholder="you@university.ac.ke" /></div>
          <TextField label={role === 'student' ? 'Registration number' : 'Staff number'} autoCapitalize="characters" value={v.idNumber} onChange={(e) => set('idNumber', e.target.value)} error={errors.idNumber} placeholder={role === 'student' ? 'e.g. SC211/0123/2025' : 'e.g. STF/0042'} />
          {role === 'student' ? (
            <SelectField label="Year of study" value={v.year} onChange={(e) => set('year', e.target.value)} error={errors.yearOfStudy}>
              {Array.from({ length: course?.durationYears ?? 4 }, (_, i) => <option key={i + 1} value={i + 1}>Year {i + 1}</option>)}
            </SelectField>
          ) : (
            <SelectField label="Title" value={v.title} onChange={(e) => set('title', e.target.value)}>
              {['Mr.', 'Ms.', 'Mrs.', 'Dr.', 'Prof.'].map((t) => <option key={t}>{t}</option>)}
            </SelectField>
          )}
          {role === 'student' ? (
            <div className="full">
              <SelectField label="Course" value={v.courseId} onChange={(e) => set('courseId', e.target.value)} error={errors.courseId} hint={course ? `${course.durationYears}-year programme · ${course.semestersPerYear} semesters a year` : courses.length === 0 ? 'Courses appear here once your administrator adds them.' : undefined}>
                <option value="">Choose your course</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SelectField>
            </div>
          ) : (
            <div className="full"><TextField label="Department" value={v.department} onChange={(e) => set('department', e.target.value)} error={errors.department} placeholder="e.g. Computing" /></div>
          )}
          <div className="full"><PasswordField label="Password" autoComplete="new-password" value={v.password} onChange={(e) => set('password', e.target.value)} error={errors.password} showStrength placeholder="Create a password" /></div>
          <div className="full"><PasswordField label="Confirm password" autoComplete="new-password" value={v.confirm} onChange={(e) => set('confirm', e.target.value)} error={errors.confirm} matchWith={v.password} placeholder="Type it again" /></div>
        </div>

        {role === 'lecturer' && <Notice>Lecturer accounts are activated by an administrator before first sign-in.</Notice>}

        <div className="field">
          <Check checked={v.agree} onChange={(x) => set('agree', x)}>I confirm the details above are mine and I agree to use Elimu responsibly.</Check>
          {errors.agree && <p className="field-error" role="alert">{errors.agree}</p>}
        </div>

        <Button kind="primary" type="submit" busy={busy}>Create account</Button>
      </form>
      <p className="auth-alt">Already have an account? <Link to="/login">Sign in</Link></p>
    </AuthLayout>
  );
}
