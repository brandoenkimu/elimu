import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlusIcon, TrashIcon, UploadIcon } from '../../../components/icons';
import { Button, Card, Check, Modal, SelectField, TextArea, TextField } from '../../../components/ui';
import { fileSize } from '../../../lib/format';
import { api } from '../../../lib/singletons';
import type { AssessmentKind, AssessmentView, FileMeta, Question } from '../../../lib/types';
import { errorText, fieldErrors } from '../../../lib/useApi';
import { useToast } from '../../../state/toast';

export const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/** "New coursework" button and the small dialog that starts a draft. The full editor opens on the next page. */
export function AssessmentCreate({ offeringId, onCreated }: { offeringId: string; onCreated(): void }) {
  const nav = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AssessmentKind>('assignment');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const create = async () => {
    setBusy(true); setErrs({});
    try {
      const r = await api.post<{ id: string }>(`/classes/${offeringId}/assessments`, {
        kind, title, durationMin: kind === 'exam' ? 60 : null, maxScore: 100, weight: 0, allowFile: kind === 'assignment', allowText: true, autoMark: true, questions: [],
      });
      onCreated(); setOpen(false); setTitle(''); nav(`work/${r.id}`);
    } catch (e) { setErrs(fieldErrors(e)); toast.show(errorText(e), 'bad'); } finally { setBusy(false); }
  };
  return (
    <>
      <div><Button kind="primary" onClick={() => setOpen(true)}><PlusIcon /> New coursework</Button></div>
      <Modal open={open} onClose={() => setOpen(false)} title="New coursework" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button kind="primary" busy={busy} disabled={title.trim().length < 3} onClick={create}>Create draft</Button></>}>
        <div className="stack">
          <SelectField label="Type" value={kind} onChange={(e) => setKind(e.target.value as AssessmentKind)}>
            <option value="assignment">Assignment (students upload or type answers)</option>
            <option value="exam">Online exam (timed questions)</option>
          </SelectField>
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={errs.title} maxLength={140} placeholder={kind === 'exam' ? 'e.g. CAT 1' : 'e.g. Assignment 2'} />
          <p className="muted">It stays hidden from students until you publish it.</p>
        </div>
      </Modal>
    </>
  );
}

type Draft = Omit<Question, 'id'> & { id?: string; options: string[] | null; correctKey: string | null; modelAnswer: string };
const blank = (kind: 'mcq' | 'text'): Draft => ({ kind, prompt: '', points: 1, options: kind === 'mcq' ? ['', '', '', ''] : null, correctKey: kind === 'mcq' ? 'A' : null, modelAnswer: '' });

/** Full editor for a draft or published piece of coursework. Questions are replaced as a set when saved. */
export function AssessmentForm({ a, onSaved }: { a: AssessmentView; onSaved(): void }) {
  const toast = useToast();
  const [title, setTitle] = useState(a.title);
  const [instructions, setInstructions] = useState(a.instructions);
  const [opensAt, setOpensAt] = useState(toLocalInput(a.opensAt));
  const [dueAt, setDueAt] = useState(toLocalInput(a.dueAt));
  const [durationMin, setDuration] = useState(a.durationMin ? String(a.durationMin) : '');
  const [maxScore, setMaxScore] = useState(String(a.maxScore));
  const [weight, setWeight] = useState(String(a.weight));
  const [allowFile, setAllowFile] = useState(a.allowFile);
  const [allowText, setAllowText] = useState(a.allowText);
  const [autoMark, setAutoMark] = useState(a.autoMark ?? true);
  const [brief, setBrief] = useState<FileMeta | null>(a.brief);
  const [questions, setQuestions] = useState<Draft[]>(a.questions.map((q) => ({ ...q, correctKey: q.correctKey ?? null, modelAnswer: q.modelAnswer ?? '' })));
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});

  const total = questions.reduce((n, q) => n + (Number(q.points) || 0), 0);
  const setQ = (i: number, patch: Partial<Draft>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const setOpt = (i: number, k: number, v: string) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, options: (q.options ?? ['', '', '', '']).map((o, n) => (n === k ? v : o)) } : q)));

  const pickBrief = async (f: File | undefined) => {
    if (!f) return;
    try { setBrief(await api.upload(f)); } catch (e) { toast.show(errorText(e), 'bad'); }
  };

  const save = async () => {
    setBusy(true); setErrs({});
    try {
      await api.patch(`/assessments/${a.id}`, {
        title, instructions, opensAt: fromLocalInput(opensAt), dueAt: fromLocalInput(dueAt),
        durationMin: a.kind === 'exam' && durationMin ? Number(durationMin) : null,
        maxScore: Number(maxScore), weight: Number(weight) || 0, allowFile, allowText, autoMark, briefFileId: brief?.id ?? null,
        questions: questions.map((q) => q.kind === 'mcq'
          ? { kind: 'mcq', prompt: q.prompt, points: Number(q.points) || 0, options: q.options ?? ['', '', '', ''], correctKey: q.correctKey ?? 'A', modelAnswer: q.modelAnswer }
          : { kind: 'text', prompt: q.prompt, points: Number(q.points) || 0, modelAnswer: q.modelAnswer }),
      });
      toast.show('Saved.', 'good'); onSaved();
    } catch (e) { setErrs(fieldErrors(e)); toast.show(errorText(e), 'bad'); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <Card className="stack">
        <h3>Details</h3>
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={errs.title} maxLength={140} />
        <TextArea label="Instructions" optional rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={5000} />
        <div className="form-grid">
          <TextField label="Opens" type="datetime-local" optional value={opensAt} onChange={(e) => setOpensAt(e.target.value)} error={errs.opensAt} />
          <TextField label={a.kind === 'exam' ? 'Closes' : 'Deadline'} type="datetime-local" optional value={dueAt} onChange={(e) => setDueAt(e.target.value)} error={errs.dueAt} />
          {a.kind === 'exam' && <TextField label="Time allowed (minutes)" type="number" min={1} max={600} value={durationMin} onChange={(e) => setDuration(e.target.value)} error={errs.durationMin} />}
          <TextField label="Total marks" type="number" min={1} value={maxScore} onChange={(e) => setMaxScore(e.target.value)} error={errs.maxScore} hint={questions.length ? `Questions add up to ${total} points, scaled to this.` : undefined} />
          <TextField label="Share of final grade (%)" type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} error={errs.weight} hint="Leave 0 to keep it out of the final grade." />
        </div>
        {a.kind === 'assignment' && (
          <div className="stack">
            <Check checked={allowFile} onChange={setAllowFile}>Students can upload files</Check>
            <Check checked={allowText} onChange={setAllowText}>Students can type an answer</Check>
          </div>
        )}
        <div className="row wrap">
          <label className="btn"><UploadIcon /> {brief ? 'Replace brief' : 'Attach brief or paper'}<input type="file" hidden onChange={(e) => pickBrief(e.target.files?.[0])} /></label>
          {brief && <span className="file-pill">{brief.name} · {fileSize(brief.size)} <button className="btn icon quiet" aria-label="Remove brief" onClick={() => setBrief(null)}><TrashIcon /></button></span>}
        </div>
      </Card>

      <Card className="stack">
        <div className="row"><h3>Questions</h3><span className="spacer" /><small className="muted">{questions.length} question{questions.length === 1 ? '' : 's'} · {total} points</small></div>
        {a.kind === 'assignment' && <p className="muted">Optional for assignments. Add questions if students should answer in the system instead of uploading a file.</p>}
        {questions.map((q, i) => (
          <div key={i} className="q-edit">
            <div className="row"><b>Question {i + 1}</b><span className="tag">{q.kind === 'mcq' ? 'Multiple choice' : 'Written answer'}</span><span className="spacer" />
              <label className="inline">Points <input className="mini" type="number" min={0} value={q.points} onChange={(e) => setQ(i, { points: Number(e.target.value) })} /></label>
              <button className="btn icon quiet" aria-label={`Delete question ${i + 1}`} onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}><TrashIcon /></button></div>
            <TextArea label="Question" rows={2} value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} error={errs[`questions.${i}.prompt`]} />
            {q.kind === 'mcq' && (
              <div className="opts">
                {['A', 'B', 'C', 'D'].map((letter, k) => (
                  <label key={letter} className={q.correctKey === letter ? 'opt-edit correct' : 'opt-edit'}>
                    <input type="radio" name={`correct-${i}`} checked={q.correctKey === letter} onChange={() => setQ(i, { correctKey: letter })} aria-label={`Mark ${letter} as the correct answer`} />
                    <b>{letter}</b>
                    <input className="opt-text" value={q.options?.[k] ?? ''} onChange={(e) => setOpt(i, k, e.target.value)} placeholder={`Option ${letter}`} aria-label={`Option ${letter}`} maxLength={300} />
                  </label>
                ))}
                <small className="muted">Select the circle next to the correct answer.</small>
              </div>
            )}
            <TextArea label={q.kind === 'mcq' ? 'Explanation (shown if you reveal answers)' : 'Marking guide (only you see this)'} optional rows={2} value={q.modelAnswer} onChange={(e) => setQ(i, { modelAnswer: e.target.value })} />
          </div>
        ))}
        <div className="row wrap">
          <Button onClick={() => setQuestions((qs) => [...qs, blank('mcq')])}><PlusIcon /> Multiple choice (A–D)</Button>
          <Button onClick={() => setQuestions((qs) => [...qs, blank('text')])}><PlusIcon /> Written answer</Button>
        </div>
        {questions.some((q) => q.kind === 'mcq') && (
          <Check checked={autoMark} onChange={setAutoMark}>Mark multiple choice automatically when students submit</Check>
        )}
      </Card>
      <div className="sticky-actions"><Button kind="primary" busy={busy} onClick={save}>Save changes</Button></div>
    </div>
  );
}
