import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackIcon, DownloadIcon, FileIcon, TimerIcon, TrashIcon, UploadIcon } from '../../../components/icons';
import { useNow } from '../../../components/bits';
import { Badge, Button, Card, Confirm, ErrorNote, Loading, Notice, PageHeader, TextArea } from '../../../components/ui';
import { dateTime, fileSize, relative } from '../../../lib/format';
import { api } from '../../../lib/singletons';
import type { AssessmentView, ClassInfo, FileMeta } from '../../../lib/types';
import { errorText, useGet } from '../../../lib/useApi';
import { useSession } from '../../../state/session';
import { useToast } from '../../../state/toast';
import { AssessmentForm } from './AssessmentEditor';
import { SubmissionsPanel } from './Marking';

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(r).padStart(2, '0')}`;
};

function BriefLink({ file }: { file: FileMeta }) {
  const toast = useToast();
  return <Button size="sm" onClick={() => api.download(`/files/${file.id}`, file.name).catch((e) => toast.show(errorText(e), 'bad'))}><DownloadIcon /> {file.name} <small>({fileSize(file.size)})</small></Button>;
}

// ------------------------------------------------------------------ student

function StudentWork({ a, onChange }: { a: AssessmentView; onChange(next: AssessmentView): void }) {
  const toast = useToast();
  const sub = a.submission ?? null;
  const [text, setText] = useState(sub?.textAnswer ?? '');
  const [choices, setChoices] = useState<Record<string, string | null>>({});
  const [written, setWritten] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<FileMeta[]>(sub?.files ?? []);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const dirty = useRef(false);
  const submittedOnce = useRef(false);
  const now = useNow(1000);

  useEffect(() => {
    if (!sub) return;
    setText(sub.textAnswer);
    setFiles(sub.files);
    const c: Record<string, string | null> = {}; const w: Record<string, string> = {};
    for (const [qid, ans] of Object.entries(sub.answers)) { c[qid] = ans.choiceKey; w[qid] = ans.textAnswer; }
    setChoices(c); setWritten(w);
    // only when the submission itself changes, not on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub?.id, sub?.status]);

  const payload = useCallback(() => ({
    textAnswer: text,
    answers: a.questions.map((q) => ({ questionId: q.id, choiceKey: (choices[q.id] as 'A' | 'B' | 'C' | 'D' | null | undefined) ?? null, textAnswer: written[q.id] ?? '' })),
    fileIds: files.map((f) => f.id),
  }), [a.questions, choices, files, text, written]);

  const editable = sub?.status === 'in_progress';
  const deadline = sub?.deadline ? new Date(sub.deadline).getTime() : null;
  const remaining = deadline && editable ? deadline - now : null;

  const submit = useCallback(async () => {
    setBusy(true);
    try { const r = await api.post<{ assessment: AssessmentView }>(`/assessments/${a.id}/submit`, payload()); dirty.current = false; onChange(r.assessment); toast.show('Submitted. Good work.', 'good'); }
    catch (e) { toast.show(errorText(e), 'bad'); } finally { setBusy(false); setConfirm(false); }
  }, [a.id, onChange, payload, toast]);

  // Autosave every few seconds while there are unsaved changes.
  useEffect(() => {
    if (!editable) return;
    const t = window.setInterval(async () => {
      if (!dirty.current) return;
      dirty.current = false;
      try { await api.put(`/assessments/${a.id}/submission`, payload()); setSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); }
      catch { dirty.current = true; }
    }, 8000);
    return () => window.clearInterval(t);
  }, [a.id, editable, payload]);

  // When the clock runs out, hand in whatever is there.
  useEffect(() => {
    if (editable && remaining !== null && remaining <= 0 && !submittedOnce.current) { submittedOnce.current = true; void submit(); }
  }, [editable, remaining, submit]);

  const start = async () => {
    setBusy(true);
    try { const r = await api.post<{ assessment: AssessmentView }>(`/assessments/${a.id}/start`); onChange(r.assessment); }
    catch (e) { toast.show(errorText(e), 'bad'); } finally { setBusy(false); }
  };
  const addFile = async (f: File | undefined) => {
    if (!f) return;
    try { const m = await api.upload(f); setFiles((l) => [...l, m]); dirty.current = true; } catch (e) { toast.show(errorText(e), 'bad'); }
  };

  const closed = a.status === 'closed' || (a.dueAt && new Date(a.dueAt).getTime() < now && !sub);
  const notOpen = a.opensAt && new Date(a.opensAt).getTime() > now;

  if (!sub) {
    return (
      <Card className="stack center-card">
        {notOpen ? <><h3>Not open yet</h3><p className="muted">Opens {dateTime(a.opensAt)}.</p></>
          : closed ? <><h3>This is closed</h3><p className="muted">The deadline has passed and no work was submitted.</p></>
          : <>
            <h3>{a.kind === 'exam' ? 'Ready to begin?' : 'Start this assignment'}</h3>
            {a.kind === 'exam' && a.durationMin && <Notice tone="warn">You have {a.durationMin} minutes once you start. The timer keeps running if you leave the page, and your answers are submitted automatically when it ends.</Notice>}
            <div><Button kind="primary" size="lg" busy={busy} onClick={start}>{a.kind === 'exam' ? 'Start exam' : 'Start'}</Button></div>
          </>}
      </Card>
    );
  }

  if (sub.status !== 'in_progress') {
    const r = sub.result;
    return (
      <div className="stack">
        <Card className="stack">
          <div className="row"><h3>Your submission</h3><span className="spacer" />{sub.isLate && <Badge tone="warn">Late</Badge>}<Badge tone="good">{sub.status === 'graded' ? 'Marked' : 'Submitted'}</Badge></div>
          <small className="muted">Handed in {dateTime(sub.submittedAt)}</small>
          {r ? (
            <div className="result-box"><div className="stat-value">{r.score}<small> / {r.maxScore}</small></div>{r.percent !== null && <div>{r.percent.toFixed(1)}% {r.letter ? `· Grade ${r.letter}` : ''}</div>}{r.feedback && <p className="pre">{r.feedback}</p>}</div>
          ) : <Notice>{sub.status === 'graded' ? 'Your lecturer has marked this. Marks are shown once they are released.' : 'Waiting to be marked. Marks are shown once your lecturer releases them.'}</Notice>}
          {sub.textAnswer && <><h4>Your typed answer</h4><p className="pre boxed">{sub.textAnswer}</p></>}
          {sub.files.map((f) => <BriefLink key={f.id} file={f} />)}
        </Card>
        {a.questions.length > 0 && a.questions.map((q, i) => {
          const ans = sub.answers[q.id];
          return (
            <Card key={q.id} className="stack">
              <div className="row"><b>{i + 1}. {q.prompt}</b><span className="spacer" />{ans?.score != null && <Badge tone="accent">{ans.score}/{q.points}</Badge>}</div>
              {q.kind === 'mcq' ? (
                <ul className="choices">{(q.options ?? []).map((o, k) => { const L = 'ABCD'[k]; return <li key={L} className={[ans?.choiceKey === L ? 'mine' : '', q.correctKey === L ? 'right' : ''].join(' ')}><b>{L}</b> {o}{ans?.choiceKey === L && <small> · your answer</small>}{q.correctKey === L && <small> · correct</small>}</li>; })}</ul>
              ) : <p className="pre boxed">{ans?.textAnswer || <span className="muted">No answer</span>}</p>}
              {ans?.feedback && <Notice>{ans.feedback}</Notice>}
              {q.modelAnswer && <small className="muted">Explanation: {q.modelAnswer}</small>}
            </Card>
          );
        })}
      </div>
    );
  }

  return (
    <div className="stack">
      {remaining !== null && <div className={`exam-clock ${remaining < 300_000 ? 'low' : ''}`} role="timer"><TimerIcon /> {clock(remaining)} left</div>}
      {a.questions.map((q, i) => (
        <Card key={q.id} className="stack">
          <div className="row"><b>{i + 1}. {q.prompt}</b><span className="spacer" /><small className="muted">{q.points} pt{q.points === 1 ? '' : 's'}</small></div>
          {q.kind === 'mcq' ? (
            <div className="choices" role="radiogroup" aria-label={`Question ${i + 1}`}>
              {(q.options ?? []).map((o, k) => { const L = 'ABCD'[k]; return (
                <label key={L} className={choices[q.id] === L ? 'choice on' : 'choice'}><input type="radio" name={q.id} checked={choices[q.id] === L} onChange={() => { setChoices({ ...choices, [q.id]: L }); dirty.current = true; }} /><b>{L}</b><span>{o}</span></label>
              ); })}
            </div>
          ) : <TextArea label="Your answer" rows={5} value={written[q.id] ?? ''} onChange={(e) => { setWritten({ ...written, [q.id]: e.target.value }); dirty.current = true; }} maxLength={10000} />}
        </Card>
      ))}
      {(a.allowText && a.questions.length === 0) && (
        <Card><TextArea label="Your answer" rows={10} value={text} onChange={(e) => { setText(e.target.value); dirty.current = true; }} maxLength={20000} hint="You can also upload a file below." /></Card>
      )}
      {a.allowFile && (
        <Card className="stack">
          <h4>Upload your work</h4>
          {files.map((f) => <div key={f.id} className="file-pill"><FileIcon /> {f.name} · {fileSize(f.size)}<button className="btn icon quiet" aria-label={`Remove ${f.name}`} onClick={() => { setFiles(files.filter((x) => x.id !== f.id)); dirty.current = true; }}><TrashIcon /></button></div>)}
          {files.length < 5 && <label className="btn"><UploadIcon /> Add a file<input type="file" hidden onChange={(e) => { void addFile(e.target.files?.[0]); e.target.value = ''; }} /></label>}
        </Card>
      )}
      <div className="sticky-actions">
        <small className="muted">{saved ? `Saved at ${saved}` : 'Your work saves automatically.'}</small><span className="spacer" />
        <Button onClick={async () => { try { await api.put(`/assessments/${a.id}/submission`, payload()); dirty.current = false; setSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); } catch (e) { toast.show(errorText(e), 'bad'); } }}>Save draft</Button>
        <Button kind="primary" busy={busy} onClick={() => setConfirm(true)}>Submit</Button>
      </div>
      <Confirm open={confirm} title="Submit your work?" confirmLabel="Submit" busy={busy} onConfirm={submit} onClose={() => setConfirm(false)}>You will not be able to change your answers after submitting.</Confirm>
    </div>
  );
}

// ------------------------------------------------------------------ page

export default function AssessmentPage({ info }: { info: ClassInfo }) {
  const { assessmentId } = useParams();
  const { user } = useSession();
  const res = useGet<{ assessment: AssessmentView }>(assessmentId ? `/assessments/${assessmentId}` : null);
  const toast = useToast();
  const [tab, setTab] = useState<'edit' | 'marks'>('marks');
  const [del, setDel] = useState(false);
  if (res.loading && !res.data) return <Loading />;
  if (res.error || !res.data) return <ErrorNote onRetry={res.reload}>{res.error ?? 'Not found.'}</ErrorNote>;
  const a = res.data.assessment;
  const staff = user!.role !== 'student';
  const back = <Link to={`/app/classes/${info.id}?tab=work`} className="back"><BackIcon /> {info.unitCode} coursework</Link>;

  const act = async (path: string, ok: string, body?: unknown) => {
    try { await api.post(`/assessments/${a.id}/${path}`, body); toast.show(ok, 'good'); res.reload(); } catch (e) { toast.show(errorText(e), 'bad'); }
  };

  return (
    <>
      <PageHeader back={back} title={a.title}
        sub={<>{a.kind === 'exam' ? 'Online exam' : 'Assignment'} · {a.maxScore} marks{a.weight ? ` · ${a.weight}% of final grade` : ''}{a.dueAt ? ` · due ${dateTime(a.dueAt)} (${relative(a.dueAt)})` : ''}{a.durationMin ? ` · ${a.durationMin} minutes` : ''}</>}
        actions={staff && <>
          {a.status === 'draft' && <Button kind="primary" onClick={() => act('publish', 'Published. Students can see it now.')}>Publish</Button>}
          {a.status === 'published' && <Button onClick={() => act('close', 'Closed to new work.')}>Close</Button>}
          {a.status === 'closed' && <Button onClick={() => act('publish', 'Re-opened.')}>Re-open</Button>}
          {a.status !== 'draft' && <Button onClick={() => act('unpublish', 'Moved back to draft.')}>Unpublish</Button>}
          <Button kind="danger" onClick={() => setDel(true)}><TrashIcon /></Button>
        </>} />
      {a.instructions && <Card><p className="pre">{a.instructions}</p></Card>}
      {a.brief && <div className="row" style={{ margin: '12px 0' }}><BriefLink file={a.brief} /></div>}
      {staff ? (
        <>
          <div className="segmented-wrap"><div className="segmented" role="tablist">
            <button role="tab" aria-selected={tab === 'marks'} className={tab === 'marks' ? 'on' : ''} onClick={() => setTab('marks')}>Submissions and marking</button>
            <button role="tab" aria-selected={tab === 'edit'} className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>Edit</button>
          </div></div>
          {tab === 'edit' ? <AssessmentForm key={a.id + a.questionCount} a={a} onSaved={res.reload} /> : <SubmissionsPanel a={a} onChanged={res.reload} />}
        </>
      ) : a.status === 'draft' ? <Notice>This is not published yet.</Notice> : <StudentWork key={a.id} a={a} onChange={(next) => res.setData({ assessment: next })} />}
      <Confirm open={del} title="Delete this coursework?" danger confirmLabel="Delete" onConfirm={async () => { try { await api.del(`/assessments/${a.id}`); window.history.back(); } catch (e) { toast.show(errorText(e), 'bad'); setDel(false); } }} onClose={() => setDel(false)}>
        Submissions and marks for it will be deleted too. This cannot be undone.
      </Confirm>
    </>
  );
}
