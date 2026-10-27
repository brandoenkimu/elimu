import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusIcon, TrashIcon } from '../../../components/icons';
import { Badge, Button, Card, Confirm, Empty, ErrorNote, Loading, Modal, PageHeader, SelectField, TextField } from '../../../components/ui';
import { api } from '../../../lib/singletons';
import type { AdminOffering, AdminUser, Course, Term, Unit } from '../../../lib/types';
import { errorText, useGet } from '../../../lib/useApi';
import { useToast } from '../../../state/toast';

function Schedule({ terms, courses, termId, lecturers, onClose, onSaved }: { terms: Term[]; courses: Course[]; termId: string; lecturers: AdminUser[]; onClose(): void; onSaved(): void }) {
  const toast = useToast();
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '');
  const units = useGet<{ units: Unit[] }>(courseId ? `/admin/units?courseId=${courseId}` : null);
  const term = terms.find((t) => t.id === termId);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [lecturerId, setLecturerId] = useState('');
  const [capacity, setCapacity] = useState('');
  const [busy, setBusy] = useState(false);
  const list = (units.data?.units ?? []).filter((u) => u.active && (!term || u.semester === term.semester));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = async () => {
    setBusy(true);
    let ok = 0; const failed: string[] = [];
    for (const unitId of picked) {
      try { await api.post('/admin/offerings', { unitId, termId, lecturerId: lecturerId || null, capacity: capacity ? Number(capacity) : null }); ok++; }
      catch (e) { failed.push(`${list.find((u) => u.id === unitId)?.code ?? 'unit'}: ${errorText(e)}`); }
    }
    setBusy(false);
    if (ok) { toast.show(`${ok} class${ok === 1 ? '' : 'es'} scheduled.`, 'good'); onSaved(); }
    if (failed.length) toast.show(failed.join(' · '), 'bad'); else onClose();
  };
  return (
    <Modal open onClose={onClose} wide title="Schedule units" footer={<><Button onClick={onClose}>Cancel</Button><Button kind="primary" busy={busy} disabled={picked.size === 0} onClick={save}>Schedule {picked.size || ''} unit{picked.size === 1 ? '' : 's'}</Button></>}>
      <div className="stack">
        <SelectField label="Course" value={courseId} onChange={(e) => { setCourseId(e.target.value); setPicked(new Set()); }}>{courses.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}</SelectField>
        {units.loading ? <Loading /> : list.length === 0 ? <p className="muted">This course has no active units in semester {term?.semester}.</p> : (
          <div className="list">{list.map((u) => (
            <label key={u.id} className="list-item"><input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} /><span className="code-chip">{u.code}</span><span className="list-main"><b>{u.name}</b><span>Year {u.yearOfStudy} · {u.creditHours} credit hours</span></span></label>
          ))}</div>
        )}
        <div className="form-grid">
          <SelectField label="Lecturer (for all selected)" value={lecturerId} onChange={(e) => setLecturerId(e.target.value)}><option value="">Assign later</option>{lecturers.map((l) => <option key={l.id} value={l.id}>{l.title ? `${l.title} ` : ''}{l.displayName}{l.staffNumber ? ` (${l.staffNumber})` : ''}</option>)}</SelectField>
          <TextField label="Seats" optional type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} hint="Leave empty for no limit." />
        </div>
      </div>
    </Modal>
  );
}

export default function AdminClasses() {
  const terms = useGet<{ terms: Term[] }>('/admin/terms');
  const courses = useGet<{ courses: Course[] }>('/admin/courses');
  const lecturers = useGet<{ users: AdminUser[] }>('/admin/users?role=lecturer&status=active&limit=200');
  const [termSel, setTermSel] = useState('');
  const termId = termSel || terms.data?.terms.find((t) => t.isCurrent)?.id || terms.data?.terms[0]?.id || '';
  const offerings = useGet<{ offerings: AdminOffering[] }>(termId ? `/admin/offerings?termId=${termId}` : null);
  const [dlg, setDlg] = useState(false);
  const [del, setDel] = useState<AdminOffering | null>(null);
  const toast = useToast();

  const patch = async (o: AdminOffering, body: Record<string, unknown>) => {
    try { await api.patch(`/admin/offerings/${o.id}`, body); offerings.reload(); } catch (e) { toast.show(errorText(e), 'bad'); }
  };
  if ((terms.loading && !terms.data) || (courses.loading && !courses.data)) return <Loading />;
  if (terms.error) return <ErrorNote onRetry={terms.reload}>{terms.error}</ErrorNote>;
  const list = offerings.data?.offerings ?? [];
  const lect = lecturers.data?.users ?? [];

  return (
    <>
      <PageHeader title="Classes and lecturers" sub="Schedule units into a semester and choose who teaches each one." actions={termId && <Button kind="primary" onClick={() => setDlg(true)}><PlusIcon /> Schedule units</Button>} />
      {(terms.data?.terms.length ?? 0) === 0 ? <Card><Empty title="Create a semester first">Classes belong to a semester. Add one under Semesters.</Empty></Card> : (
        <div className="stack">
          <SelectField label="Semester" value={termId} onChange={(e) => setTermSel(e.target.value)}>{terms.data!.terms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isCurrent ? ' (current)' : ''}</option>)}</SelectField>
          {offerings.loading && !offerings.data ? <Loading /> : offerings.error ? <ErrorNote onRetry={offerings.reload}>{offerings.error}</ErrorNote> : list.length === 0 ? <Card><Empty title="No classes scheduled">Choose “Schedule units” to add this semester's classes.</Empty></Card> : (
            <Card><div className="table-wrap"><table className="table">
              <thead><tr><th>Unit</th><th>Course</th><th>Year / sem</th><th>Lecturer</th><th>Seats</th><th className="r">Students</th><th /></tr></thead>
              <tbody>{list.map((o) => (
                <tr key={o.id}>
                  <td><Link to={`/app/classes/${o.id}`}><span className="code-chip">{o.unitCode}</span> {o.unitName}</Link></td><td>{o.courseName}</td><td>Y{o.yearOfStudy} · S{o.semester}</td>
                  <td><select className="select-inline" value={o.lecturerId ?? ''} onChange={(e) => patch(o, { lecturerId: e.target.value || null })} aria-label={`Lecturer for ${o.unitCode}`}><option value="">{'Unassigned'}</option>{lect.map((l) => <option key={l.id} value={l.id}>{l.displayName}</option>)}{o.lecturerId && !lect.some((l) => l.id === o.lecturerId) && <option value={o.lecturerId}>{o.lecturerName}</option>}</select></td>
                  <td><input className="mini" type="number" min={1} defaultValue={o.capacity ?? ''} placeholder="∞" aria-label={`Seats for ${o.unitCode}`} onBlur={(e) => { const v = e.target.value ? Number(e.target.value) : null; if (v !== o.capacity) void patch(o, { capacity: v }); }} /></td>
                  <td className="r">{o.enrolled}</td>
                  <td className="r">{!o.lecturerId && <Badge tone="warn">No lecturer</Badge>} <button className="btn icon quiet" aria-label={`Remove ${o.unitCode}`} onClick={() => setDel(o)}><TrashIcon /></button></td>
                </tr>
              ))}</tbody>
            </table></div></Card>
          )}
        </div>
      )}
      {dlg && courses.data && <Schedule terms={terms.data!.terms} courses={courses.data.courses} termId={termId} lecturers={lect} onClose={() => setDlg(false)} onSaved={offerings.reload} />}
      <Confirm open={!!del} danger title={`Remove ${del?.unitCode ?? ''} from this semester?`} confirmLabel="Remove" onConfirm={async () => { try { await api.del(`/admin/offerings/${del!.id}`); offerings.reload(); } catch (e) { toast.show(errorText(e), 'bad'); } setDel(null); }} onClose={() => setDel(null)}>
        {del?.enrolled ? `${del.enrolled} registered students and all coursework for this class will be affected.` : 'Nobody is registered yet.'}
      </Confirm>
    </>
  );
}
