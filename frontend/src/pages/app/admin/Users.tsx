import { useState } from 'react';
import { Avatar } from '../../../components/bits';
import { PlusIcon, SearchIcon } from '../../../components/icons';
import { Badge, Button, Card, CopyText, Empty, ErrorNote, Loading, Modal, Notice, PageHeader, SelectField, TextField, useDebounced } from '../../../components/ui';
import { dateTime, roleLabel } from '../../../lib/format';
import { api } from '../../../lib/singletons';
import type { AccountStatus, AdminUser, Course, Role } from '../../../lib/types';
import { errorText, fieldErrors, useGet } from '../../../lib/useApi';
import { useSession } from '../../../state/session';
import { useToast } from '../../../state/toast';

const statusTone = (s: AccountStatus) => (s === 'active' ? 'good' : s === 'pending' ? 'warn' : 'bad');

function UserForm({ initial, courses, onClose, onSaved }: { initial: AdminUser | null; courses: Course[]; onClose(): void; onSaved(): void }) {
  const toast = useToast();
  const { user: me } = useSession();
  const editing = !!initial;
  const [f, setF] = useState({
    role: (initial?.role ?? 'student') as Role, displayName: initial?.displayName ?? '', email: initial?.email ?? '', status: (initial?.status ?? 'active') as AccountStatus,
    regNumber: initial?.regNumber ?? '', staffNumber: initial?.staffNumber ?? '', courseId: initial?.courseId ?? '', yearOfStudy: String(initial?.yearOfStudy ?? 1), department: initial?.department ?? '', title: initial?.title ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [temp, setTemp] = useState<{ password: string; emailed: boolean } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const course = courses.find((c) => c.id === f.courseId);
  const self = initial?.id === me?.id;

  const save = async () => {
    setBusy(true); setErrs({});
    try {
      if (editing) {
        await api.patch(`/admin/users/${initial!.id}`, {
          displayName: f.displayName, email: f.email, role: f.role, status: f.status,
          regNumber: f.role === 'student' ? f.regNumber || null : null, staffNumber: f.role === 'lecturer' ? f.staffNumber || null : null,
          courseId: f.role === 'student' ? f.courseId || null : null, yearOfStudy: f.role === 'student' ? Number(f.yearOfStudy) : null,
          department: f.role === 'student' ? null : f.department || null, title: f.role === 'lecturer' ? f.title || null : null,
        });
        toast.show('User updated.', 'good'); onSaved(); onClose();
      } else {
        const r = await api.post<{ id: string; temporaryPassword: string; emailed: boolean }>('/admin/users', {
          role: f.role, displayName: f.displayName, email: f.email,
          ...(f.role === 'student' ? { regNumber: f.regNumber, ...(f.courseId ? { courseId: f.courseId, yearOfStudy: Number(f.yearOfStudy) } : {}) } : {}),
          ...(f.role === 'lecturer' ? { staffNumber: f.staffNumber, department: f.department, title: f.title } : {}),
        });
        setTemp({ password: r.temporaryPassword, emailed: r.emailed }); onSaved();
      }
    } catch (e) { setErrs(fieldErrors(e)); toast.show(errorText(e), 'bad'); } finally { setBusy(false); }
  };

  const resetPw = async () => {
    setBusy(true);
    try { const r = await api.post<{ temporaryPassword: string; emailed: boolean }>(`/admin/users/${initial!.id}/reset-password`); setTemp({ password: r.temporaryPassword, emailed: r.emailed }); }
    catch (e) { toast.show(errorText(e), 'bad'); } finally { setBusy(false); }
  };

  if (temp) {
    return (
      <Modal open onClose={onClose} title="Temporary password" footer={<Button kind="primary" onClick={onClose}>Done</Button>}>
        <div className="stack">
          <Notice tone="warn">Shown once. {temp.emailed ? 'It was also emailed to the user.' : 'Email is not configured, so give it to the user yourself.'} They must choose a new password when they first sign in.</Notice>
          <div className="temp-pw"><code>{temp.password}</code><CopyText text={temp.password} label="Copy" /></div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} wide title={editing ? `Edit ${initial!.displayName}` : 'Add a user'}
      footer={<>{editing && <Button onClick={resetPw} busy={busy}>Reset password</Button>}<span className="spacer" /><Button onClick={onClose}>Cancel</Button><Button kind="primary" busy={busy} onClick={save}>{editing ? 'Save changes' : 'Create account'}</Button></>}>
      <div className="form-grid">
        <SelectField label="Role" value={f.role} onChange={set('role')} disabled={self} hint={self ? 'You cannot change your own role.' : undefined}>
          <option value="student">Student</option><option value="lecturer">Lecturer</option><option value="admin">Administrator</option>
        </SelectField>
        {editing && <SelectField label="Account status" value={f.status} onChange={set('status')} disabled={self}><option value="active">Active</option><option value="pending">Pending approval</option><option value="suspended">Suspended</option></SelectField>}
        <TextField label="Full name" value={f.displayName} onChange={set('displayName')} error={errs.displayName} />
        <TextField label="Email" type="email" value={f.email} onChange={set('email')} error={errs.email} />
        {f.role === 'student' && <TextField label="Registration number" value={f.regNumber} onChange={set('regNumber')} error={errs.regNumber} placeholder="e.g. SC211/0001/2024" />}
        {f.role === 'lecturer' && <TextField label="Staff number" value={f.staffNumber} onChange={set('staffNumber')} error={errs.staffNumber} placeholder="e.g. STF/0142" />}
        {f.role === 'student' && (
          <>
            <SelectField label="Course" value={f.courseId} onChange={set('courseId')} error={errs.courseId}><option value="">Not set</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}</SelectField>
            <SelectField label="Year of study" value={f.yearOfStudy} onChange={set('yearOfStudy')}>{Array.from({ length: course?.durationYears ?? 7 }, (_, i) => <option key={i + 1} value={i + 1}>Year {i + 1}</option>)}</SelectField>
          </>
        )}
        {f.role === 'lecturer' && <><TextField label="Title" optional value={f.title} onChange={set('title')} placeholder="Dr., Prof." /><TextField label="Department" value={f.department} onChange={set('department')} error={errs.department} /></>}
      </div>
      {!editing && <p className="muted">A temporary password is generated. The user must change it when they first sign in.</p>}
    </Modal>
  );
}

export default function Users({ pendingOnly }: { pendingOnly?: boolean }) {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState(pendingOnly ? 'pending' : '');
  const [page, setPage] = useState(0);
  const term = useDebounced(q.trim(), 300);
  const LIMIT = 25;
  const qs = new URLSearchParams({ limit: String(LIMIT), offset: String(page * LIMIT) });
  if (term) qs.set('q', term);
  if (role) qs.set('role', role);
  const st = pendingOnly ? 'pending' : status;
  if (st) qs.set('status', st);
  const res = useGet<{ users: AdminUser[]; total: number }>(`/admin/users?${qs}`);
  const courses = useGet<{ courses: Course[] }>('/admin/courses');
  const [edit, setEdit] = useState<AdminUser | 'new' | null>(null);
  const toast = useToast();

  const approve = async (u: AdminUser) => {
    try { await api.patch(`/admin/users/${u.id}`, { status: 'active' }); toast.show(`${u.displayName} approved.`, 'good'); res.reload(); } catch (e) { toast.show(errorText(e), 'bad'); }
  };
  const users = res.data?.users ?? [];
  const total = res.data?.total ?? 0;
  return (
    <>
      <PageHeader title={pendingOnly ? 'Approvals' : 'Users'} sub={pendingOnly ? 'Lecturer accounts wait here until you approve them.' : `${total} account${total === 1 ? '' : 's'}`}
        actions={!pendingOnly && <Button kind="primary" onClick={() => setEdit('new')}><PlusIcon /> Add user</Button>} />
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <label className="search grow"><SearchIcon /><input placeholder="Search name, email or number" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Search users" /></label>
        <select className="select-inline" value={role} onChange={(e) => { setRole(e.target.value); setPage(0); }} aria-label="Role"><option value="">All roles</option><option value="student">Students</option><option value="lecturer">Lecturers</option><option value="admin">Administrators</option></select>
        {!pendingOnly && <select className="select-inline" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option></select>}
      </div>
      {res.loading && !res.data ? <Loading /> : res.error ? <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote> : users.length === 0 ? <Card><Empty title={pendingOnly ? 'Nobody is waiting' : 'No users match'}>{pendingOnly ? 'New lecturer sign-ups will appear here.' : 'Try clearing the filters.'}</Empty></Card> : (
        <Card><div className="table-wrap"><table className="table">
          <thead><tr><th>Name</th><th>Role</th><th>Number</th><th>Course / department</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id}>
              <td><span className="row"><Avatar name={u.displayName} size={30} /><span><b>{u.displayName}</b><br /><small className="muted">{u.email}</small></span></span></td>
              <td>{roleLabel(u.role)}</td><td>{u.regNumber ?? u.staffNumber ?? '—'}</td>
              <td>{u.role === 'student' ? `${u.courseName ?? '—'}${u.yearOfStudy ? `, Y${u.yearOfStudy}` : ''}` : u.department ?? '—'}</td>
              <td><Badge tone={statusTone(u.status)}>{u.status === 'pending' ? 'Pending' : u.status === 'active' ? 'Active' : 'Suspended'}</Badge></td>
              <td>{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Never'}</td>
              <td className="r"><span className="row end">{u.status === 'pending' && <Button size="sm" kind="primary" onClick={() => approve(u)}>Approve</Button>}<Button size="sm" onClick={() => setEdit(u)}>Edit</Button></span></td>
            </tr>
          ))}</tbody>
        </table></div></Card>
      )}
      {total > LIMIT && <div className="row" style={{ marginTop: 12 }}><Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><span className="muted">Page {page + 1} of {Math.ceil(total / LIMIT)}</span><Button size="sm" disabled={(page + 1) * LIMIT >= total} onClick={() => setPage(page + 1)}>Next</Button></div>}
      {edit && <UserForm initial={edit === 'new' ? null : edit} courses={courses.data?.courses ?? []} onClose={() => setEdit(null)} onSaved={res.reload} />}
    </>
  );
}
