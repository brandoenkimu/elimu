import { useState } from 'react';
import { PlusIcon, TrashIcon, EditIcon } from '../../../components/icons';
import { Badge, Button, Card, Confirm, Empty, ErrorNote, Loading, Modal, PageHeader, SelectField, TextArea, TextField, Toggle } from '../../../components/ui';
import { api } from '../../../lib/singletons';
import type { Course, Unit } from '../../../lib/types';
import { errorText, fieldErrors, useGet } from '../../../lib/useApi';
import { useToast } from '../../../state/toast';

function CourseDialog({ c, onClose, onSaved }: { c: Course | null; onClose(): void; onSaved(): void }) {
  const toast = useToast();
  const [f, setF] = useState({ code: c?.code ?? '', name: c?.name ?? '', department: c?.department ?? '', durationYears: String(c?.durationYears ?? 4), semestersPerYear: String(c?.semestersPerYear ?? 2), active: c?.active ?? true });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: 'code' | 'name' | 'department' | 'durationYears' | 'semestersPerYear') => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => {
    setBusy(true); setErrs({});
    const body = { code: f.code, name: f.name, department: f.department, durationYears: Number(f.durationYears), semestersPerYear: Number(f.semestersPerYear), active: f.active };
    try { if (c) await api.patch(`/admin/courses/${c.id}`, body); else await api.post('/admin/courses', body); toast.show('Course saved.', 'good'); onSaved(); onClose(); }
    catch (e) { setErrs(fieldErrors(e)); toast.show(errorText(e), 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={c ? 'Edit course' : 'New course'} footer={<><Button onClick={onClose}>Cancel</Button><Button kind="primary" busy={busy} onClick={save}>Save</Button></>}>
      <div className="stack">
        <div className="form-grid"><TextField label="Course code" value={f.code} onChange={set('code')} error={errs.code} placeholder="e.g. BSC-CS" /><TextField label="Department" optional value={f.department} onChange={set('department')} /></div>
        <TextField label="Course name" value={f.name} onChange={set('name')} error={errs.name} placeholder="e.g. Bachelor of Science in Computer Science" />
        <div className="form-grid">
          <SelectField label="Years to complete" value={f.durationYears} onChange={set('durationYears')}>{[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n} year{n > 1 ? 's' : ''}</option>)}</SelectField>
          <SelectField label="Semesters per year" value={f.semestersPerYear} onChange={set('semestersPerYear')}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</SelectField>
        </div>
        <Toggle checked={f.active} onChange={(v) => setF((s) => ({ ...s, active: v }))} label="Open for new students" hint="Inactive courses are hidden from sign-up." />
      </div>
    </Modal>
  );
}

function UnitDialog({ course, u, onClose, onSaved }: { course: Course; u: Unit | null; onClose(): void; onSaved(): void }) {
  const toast = useToast();
  const [f, setF] = useState({ code: u?.code ?? '', name: u?.name ?? '', yearOfStudy: String(u?.yearOfStudy ?? 1), semester: String(u?.semester ?? 1), creditHours: String(u?.creditHours ?? 3), description: u?.description ?? '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => {
    setBusy(true); setErrs({});
    const body = { code: f.code, name: f.name, yearOfStudy: Number(f.yearOfStudy), semester: Number(f.semester), creditHours: Number(f.creditHours), description: f.description };
    try { if (u) await api.patch(`/admin/units/${u.id}`, body); else await api.post('/admin/units', { ...body, courseId: course.id }); toast.show('Unit saved.', 'good'); onSaved(); onClose(); }
    catch (e) { setErrs(fieldErrors(e)); toast.show(errorText(e), 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={u ? `Edit ${u.code}` : `New unit in ${course.code}`} footer={<><Button onClick={onClose}>Cancel</Button><Button kind="primary" busy={busy} onClick={save}>Save</Button></>}>
      <div className="stack">
        <div className="form-grid"><TextField label="Unit code" value={f.code} onChange={set('code')} error={errs.code} placeholder="e.g. CSC 201" /><TextField label="Credit hours" type="number" min={1} max={30} value={f.creditHours} onChange={set('creditHours')} error={errs.creditHours} /></div>
        <TextField label="Unit name" value={f.name} onChange={set('name')} error={errs.name} />
        <div className="form-grid">
          <SelectField label="Year of study" value={f.yearOfStudy} onChange={set('yearOfStudy')}>{Array.from({ length: course.durationYears }, (_, i) => <option key={i + 1} value={i + 1}>Year {i + 1}</option>)}</SelectField>
          <SelectField label="Semester" value={f.semester} onChange={set('semester')}>{Array.from({ length: course.semestersPerYear }, (_, i) => <option key={i + 1} value={i + 1}>Semester {i + 1}</option>)}</SelectField>
        </div>
        <TextArea label="Description" optional rows={2} value={f.description} onChange={set('description')} maxLength={600} />
      </div>
    </Modal>
  );
}

export default function Courses() {
  const courses = useGet<{ courses: Course[] }>('/admin/courses');
  const [sel, setSel] = useState<string | null>(null);
  const cur = courses.data?.courses.find((c) => c.id === sel) ?? courses.data?.courses[0] ?? null;
  const units = useGet<{ units: Unit[] }>(cur ? `/admin/units?courseId=${cur.id}` : null);
  const [courseDlg, setCourseDlg] = useState<Course | 'new' | null>(null);
  const [unitDlg, setUnitDlg] = useState<Unit | 'new' | null>(null);
  const [del, setDel] = useState<{ kind: 'course' | 'unit'; id: string; label: string } | null>(null);
  const toast = useToast();

  const remove = async () => {
    if (!del) return;
    try { await api.del(`/admin/${del.kind === 'course' ? 'courses' : 'units'}/${del.id}`); toast.show('Deleted.', 'good'); courses.reload(); units.reload(); if (del.kind === 'course') setSel(null); }
    catch (e) { toast.show(errorText(e), 'bad'); }
    setDel(null);
  };

  const grid = cur && units.data ? Array.from({ length: cur.durationYears }, (_, y) => Array.from({ length: cur.semestersPerYear }, (_, s) => units.data!.units.filter((u) => u.yearOfStudy === y + 1 && u.semester === s + 1))) : [];

  return (
    <>
      <PageHeader title="Courses and units" sub="Define what is taught, which year and semester each unit belongs to, and its credit hours." actions={<Button kind="primary" onClick={() => setCourseDlg('new')}><PlusIcon /> New course</Button>} />
      {courses.loading && !courses.data ? <Loading /> : courses.error ? <ErrorNote onRetry={courses.reload}>{courses.error}</ErrorNote> : (courses.data?.courses.length ?? 0) === 0 ? <Card><Empty title="No courses yet">Add your first course, then add its units year by year.</Empty></Card> : (
        <div className="split">
          <Card className="course-list"><div className="list">
            {courses.data!.courses.map((c) => (
              <button key={c.id} className={`list-item pick ${cur?.id === c.id ? 'on' : ''}`} onClick={() => setSel(c.id)}>
                <span className="list-main"><b>{c.name}</b><span>{c.code} · {c.durationYears} yrs · {c.semestersPerYear} sem/yr · {c.unitCount ?? 0} units · {c.studentCount ?? 0} students</span></span>
                {c.active === false && <Badge tone="warn">Closed</Badge>}
              </button>
            ))}
          </div></Card>
          {cur && (
            <div className="stack">
              <div className="row wrap"><h2 className="grow">{cur.name}</h2><Button size="sm" onClick={() => setCourseDlg(cur)}><EditIcon /> Edit</Button><Button size="sm" kind="danger" onClick={() => setDel({ kind: 'course', id: cur.id, label: cur.name })}><TrashIcon /></Button><Button size="sm" kind="primary" onClick={() => setUnitDlg('new')}><PlusIcon /> Add unit</Button></div>
              {units.loading && !units.data ? <Loading /> : grid.map((sems, y) => (
                <Card key={y} className="stack">
                  <h3>Year {y + 1}</h3>
                  <div className="sem-grid">{sems.map((list, s) => (
                    <div key={s} className="sem-col"><div className="sem-title">Semester {s + 1}</div>
                      {list.length === 0 ? <p className="muted">No units</p> : list.map((u) => (
                        <div key={u.id} className="unit-row"><span className="code-chip">{u.code}</span><span className="grow">{u.name}<small className="muted"> · {u.creditHours} cr</small></span>
                          <button className="btn icon quiet" aria-label={`Edit ${u.code}`} onClick={() => setUnitDlg(u)}><EditIcon /></button>
                          <button className="btn icon quiet" aria-label={`Delete ${u.code}`} onClick={() => setDel({ kind: 'unit', id: u.id, label: `${u.code} ${u.name}` })}><TrashIcon /></button></div>
                      ))}</div>
                  ))}</div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
      {courseDlg && <CourseDialog c={courseDlg === 'new' ? null : courseDlg} onClose={() => setCourseDlg(null)} onSaved={courses.reload} />}
      {unitDlg && cur && <UnitDialog course={cur} u={unitDlg === 'new' ? null : unitDlg} onClose={() => setUnitDlg(null)} onSaved={() => { units.reload(); courses.reload(); }} />}
      <Confirm open={!!del} danger title={`Delete ${del?.label ?? ''}?`} confirmLabel="Delete" onConfirm={remove} onClose={() => setDel(null)}>This cannot be undone. Anything that depends on it (classes, registrations, marks) may block the delete.</Confirm>
    </>
  );
}
