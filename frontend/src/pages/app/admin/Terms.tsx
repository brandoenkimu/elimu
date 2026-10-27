import { useState } from 'react';
import { PlusIcon } from '../../../components/icons';
import { Badge, Button, Card, Empty, ErrorNote, Loading, Modal, PageHeader, SelectField, TextField, Toggle } from '../../../components/ui';
import { api } from '../../../lib/singletons';
import type { Term } from '../../../lib/types';
import { errorText, fieldErrors, useGet } from '../../../lib/useApi';
import { useToast } from '../../../state/toast';

const nextYear = () => { const y = new Date().getFullYear(); return `${y}/${y + 1}`; };

function TermDialog({ onClose, onSaved }: { onClose(): void; onSaved(): void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', academicYear: nextYear(), semester: '1', startsOn: '', endsOn: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => {
    setBusy(true); setErrs({});
    try { await api.post('/admin/terms', { name: f.name || `${f.academicYear} Semester ${f.semester}`, academicYear: f.academicYear, semester: Number(f.semester), startsOn: f.startsOn || null, endsOn: f.endsOn || null }); toast.show('Semester created.', 'good'); onSaved(); onClose(); }
    catch (e) { setErrs(fieldErrors(e)); toast.show(errorText(e), 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="New semester" footer={<><Button onClick={onClose}>Cancel</Button><Button kind="primary" busy={busy} onClick={save}>Create</Button></>}>
      <div className="stack">
        <div className="form-grid"><TextField label="Academic year" value={f.academicYear} onChange={set('academicYear')} error={errs.academicYear} placeholder="2026/2027" />
          <SelectField label="Semester" value={f.semester} onChange={set('semester')}><option value="1">Semester 1</option><option value="2">Semester 2</option><option value="3">Semester 3</option></SelectField></div>
        <TextField label="Name" optional value={f.name} onChange={set('name')} error={errs.name} placeholder={`${f.academicYear} Semester ${f.semester}`} />
        <div className="form-grid"><TextField label="Starts" type="date" optional value={f.startsOn} onChange={set('startsOn')} error={errs.startsOn} /><TextField label="Ends" type="date" optional value={f.endsOn} onChange={set('endsOn')} error={errs.endsOn} /></div>
      </div>
    </Modal>
  );
}

export default function Terms() {
  const res = useGet<{ terms: Term[] }>('/admin/terms');
  const toast = useToast();
  const [dlg, setDlg] = useState(false);
  const patch = async (t: Term, body: Partial<Term>) => {
    try { await api.patch(`/admin/terms/${t.id}`, body); res.reload(); } catch (e) { toast.show(errorText(e), 'bad'); }
  };
  return (
    <>
      <PageHeader title="Semesters" sub="Only the current semester is shown to students. Open registration and evaluations when you are ready." actions={<Button kind="primary" onClick={() => setDlg(true)}><PlusIcon /> New semester</Button>} />
      {res.loading && !res.data ? <Loading /> : res.error ? <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote> : (res.data?.terms.length ?? 0) === 0 ? <Card><Empty title="No semesters yet">Create the first semester, then schedule units into it under Classes.</Empty></Card> : (
        <div className="stack">{res.data!.terms.map((t) => (
          <Card key={t.id} className="stack">
            <div className="row wrap"><h3 className="grow">{t.name}</h3>{t.isCurrent ? <Badge tone="accent">Current</Badge> : <Button size="sm" onClick={() => patch(t, { isCurrent: true })}>Make current</Button>}</div>
            <small className="muted">Academic year {t.academicYear} · Semester {t.semester}{t.startsOn ? ` · ${t.startsOn} to ${t.endsOn ?? '…'}` : ''}</small>
            <div className="form-grid">
              <Toggle checked={t.registrationOpen} onChange={(v) => patch(t, { registrationOpen: v })} label="Unit registration open" hint="Students can add and drop units." />
              <Toggle checked={t.evaluationOpen} onChange={(v) => patch(t, { evaluationOpen: v })} label="Unit evaluation open" hint="Students can rate their units. Lecturers never see names." />
            </div>
          </Card>
        ))}</div>
      )}
      {dlg && <TermDialog onClose={() => setDlg(false)} onSaved={res.reload} />}
    </>
  );
}
