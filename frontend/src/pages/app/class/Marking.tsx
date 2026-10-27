import { useEffect, useState } from 'react';
import { Avatar } from '../../../components/bits';
import { Badge, Button, Card, Check, Empty, ErrorNote, Loading, Modal, Notice, TextArea, TextField } from '../../../components/ui';
import { dateTime, fileSize } from '../../../lib/format';
import { api } from '../../../lib/singletons';
import type { AssessmentView, SubmissionDetail, SubmissionRowT } from '../../../lib/types';
import { errorText, useGet } from '../../../lib/useApi';
import { useToast } from '../../../state/toast';

const statusBadge = (s: SubmissionRowT) =>
  s.status === 'graded' ? <Badge tone="good">Marked</Badge> : s.status === 'submitted' ? <Badge tone="warn">{s.isLate ? 'To mark (late)' : 'To mark'}</Badge>
  : s.status === 'in_progress' ? <Badge>In progress</Badge> : <Badge tone="bad">Not started</Badge>;

function GradeDialog({ id, onClose }: { id: string; onClose(saved: boolean): void }) {
  const res = useGet<{ submission: SubmissionDetail }>(`/submissions/${id}`);
  const toast = useToast();
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [perQ, setPerQ] = useState<Record<string, { score: string; feedback: string }>>({});
  const [busy, setBusy] = useState(false);
  const s = res.data?.submission;

  useEffect(() => {
    if (!s) return;
    setScore(s.score === null ? '' : String(s.score)); setFeedback(s.feedback);
    const m: Record<string, { score: string; feedback: string }> = {};
    for (const q of s.questions) { const a = s.answers[q.id]; m[q.id] = { score: a?.score == null ? '' : String(a.score), feedback: a?.feedback ?? '' }; }
    setPerQ(m);
  }, [s]);

  const hasQuestions = !!s && s.questions.length > 0;
  const sum = hasQuestions ? s!.questions.reduce((n, q) => n + (Number(perQ[q.id]?.score) || 0), 0) : null;

  const save = async () => {
    if (!s) return;
    setBusy(true);
    try {
      const body = hasQuestions
        ? { feedback, answers: s.questions.filter((q) => perQ[q.id]?.score !== '').map((q) => ({ questionId: q.id, score: Number(perQ[q.id].score), feedback: perQ[q.id].feedback })) }
        : { feedback, score: Number(score) };
      await api.put(`/submissions/${id}/grade`, body);
      toast.show('Marks saved.', 'good'); onClose(true);
    } catch (e) { toast.show(errorText(e), 'bad'); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={() => onClose(false)} wide title={s ? `${s.student.name}${s.student.regNumber ? ` · ${s.student.regNumber}` : ''}` : 'Marking'}
      footer={<><Button onClick={() => onClose(false)}>Cancel</Button><Button kind="primary" busy={busy} onClick={save} disabled={!s || (!hasQuestions && score === '')}>Save marks</Button></>}>
      {res.loading ? <Loading /> : res.error || !s ? <ErrorNote onRetry={res.reload}>{res.error ?? 'Not found.'}</ErrorNote> : (
        <div className="stack">
          <small className="muted">Handed in {dateTime(s.submittedAt)}{s.isLate ? ' (late)' : ''}</small>
          {s.textAnswer && <><h4>Typed answer</h4><p className="pre boxed">{s.textAnswer}</p></>}
          {s.files.map((f) => <Button key={f.id} size="sm" onClick={() => api.download(`/files/${f.id}`, f.name).catch((e) => toast.show(errorText(e), 'bad'))}>Download {f.name} ({fileSize(f.size)})</Button>)}
          {s.questions.map((q) => {
            const a = s.answers[q.id];
            return (
              <div key={q.id} className="q-mark">
                <b>{q.position + 1}. {q.prompt}</b>
                {q.kind === 'mcq' ? (
                  <p>Chose <b>{a?.choiceKey ?? 'nothing'}</b>{' '}{a?.choiceKey && a.choiceKey === q.correctKey ? <Badge tone="good">Correct</Badge> : <Badge tone="bad">Correct answer {q.correctKey}</Badge>}</p>
                ) : <p className="pre boxed">{a?.textAnswer || <span className="muted">No answer given</span>}</p>}
                {q.modelAnswer && <small className="muted">Guide: {q.modelAnswer}</small>}
                <div className="row wrap end">
                  <TextField label={`Marks (of ${q.points})`} type="number" min={0} max={q.points} value={perQ[q.id]?.score ?? ''} onChange={(e) => setPerQ({ ...perQ, [q.id]: { ...(perQ[q.id] ?? { feedback: '' }), score: e.target.value } })} />
                  <TextField label="Comment" optional value={perQ[q.id]?.feedback ?? ''} onChange={(e) => setPerQ({ ...perQ, [q.id]: { ...(perQ[q.id] ?? { score: '' }), feedback: e.target.value } })} />
                </div>
              </div>
            );
          })}
          {hasQuestions ? <Notice>Question marks add up to {sum} of {s.questions.reduce((n, q) => n + q.points, 0)} points. The total is scaled to {s.maxScore} marks.</Notice>
            : <TextField label={`Mark (out of ${s.maxScore})`} type="number" min={0} max={s.maxScore} value={score} onChange={(e) => setScore(e.target.value)} />}
          <TextArea label="Feedback for the student" optional rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={4000} />
        </div>
      )}
    </Modal>
  );
}

export function SubmissionsPanel({ a, onChanged }: { a: AssessmentView; onChanged(): void }) {
  const res = useGet<{ maxScore: number; resultsReleased: boolean; submissions: SubmissionRowT[] }>(`/assessments/${a.id}/submissions`);
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [showAnswers, setShowAnswers] = useState(!!a.showAnswers);
  const [busy, setBusy] = useState(false);
  const rows = res.data?.submissions ?? [];
  const released = res.data?.resultsReleased ?? a.resultsReleased;
  const hasMcq = a.questions.some((q) => q.kind === 'mcq');
  const toMark = rows.filter((r) => r.status === 'submitted').length;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.show(ok, 'good'); res.reload(); onChanged(); } catch (e) { toast.show(errorText(e), 'bad'); } finally { setBusy(false); }
  };

  if (res.loading && !res.data) return <Loading />;
  if (res.error) return <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote>;
  return (
    <div className="stack">
      {a.status === 'draft' && <Notice tone="warn">This is a draft. Students cannot see it until you publish it.</Notice>}
      <Card className="stack">
        <div className="row wrap">
          <div><b>{rows.filter((r) => r.status === 'submitted' || r.status === 'graded').length}</b> of {rows.length} handed in · <b>{toMark}</b> waiting to be marked</div><span className="spacer" />
          {hasMcq && <Button busy={busy} onClick={() => run(() => api.post(`/assessments/${a.id}/auto-mark`), 'Multiple choice marked.')}>Auto-mark multiple choice</Button>}
        </div>
        <hr />
        <div className="row wrap">
          <div className="grow"><b>{released ? 'Results are visible to students' : 'Results are hidden from students'}</b><p className="muted">Students only see their marks after you release them. You can hide them again at any time.</p></div>
          <Check checked={showAnswers} onChange={setShowAnswers}>Also show correct answers</Check>
          <Button kind={released ? undefined : 'primary'} busy={busy} onClick={() => run(() => api.post(`/assessments/${a.id}/release`, { released: !released, showAnswers }), released ? 'Results hidden.' : 'Results released. Students were notified.')}>{released ? 'Hide results' : 'Release results'}</Button>
        </div>
      </Card>
      {rows.length === 0 ? <Card><Empty title="No students registered">Students appear here once they register for the unit.</Empty></Card> : (
        <Card><div className="table-wrap"><table className="table">
          <thead><tr><th>Student</th><th>Status</th><th>Handed in</th><th className="r">Score</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.studentId}>
              <td><span className="row"><Avatar name={r.studentName} size={28} /><span><b>{r.studentName}</b><br /><small className="muted">{r.regNumber ?? 'No reg. number'}</small></span></span></td>
              <td>{statusBadge(r)}</td><td>{r.submittedAt ? dateTime(r.submittedAt) : '—'}</td>
              <td className="r">{r.score ?? (r.mcqScore !== null ? <span className="muted">{r.mcqScore} (MCQ)</span> : '—')}</td>
              <td className="r">{r.submissionId && (r.status === 'submitted' || r.status === 'graded') && <Button size="sm" onClick={() => setOpen(r.submissionId)}>{r.status === 'graded' ? 'Review' : 'Mark'}</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div></Card>
      )}
      {open && <GradeDialog id={open} onClose={(saved) => { setOpen(null); if (saved) { res.reload(); onChanged(); } }} />}
    </div>
  );
}
