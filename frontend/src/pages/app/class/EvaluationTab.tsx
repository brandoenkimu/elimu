import { useState } from 'react';
import { StarIcon } from '../../../components/icons';
import { Button, Card, Empty, ErrorNote, Loading, Notice, TextArea } from '../../../components/ui';
import { api } from '../../../lib/singletons';
import type { EvaluationResults, EvaluationStatus } from '../../../lib/types';
import { errorText, useGet } from '../../../lib/useApi';
import { useToast } from '../../../state/toast';

const LABELS = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];

function StudentForm({ id }: { id: string }) {
  const res = useGet<EvaluationStatus>(`/classes/${id}/evaluation`);
  const toast = useToast();
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  if (res.loading) return <Loading />;
  if (res.error || !res.data) return <ErrorNote onRetry={res.reload}>{res.error ?? 'Could not load the evaluation.'}</ErrorNote>;
  const ev = res.data;
  if (ev.submitted) return <Card><Empty title="Thank you" icon={<StarIcon />}>Your evaluation was received. Your lecturer sees only combined results, never your name.</Empty></Card>;
  if (!ev.open) return <Card><Empty title="Evaluation is not open" icon={<StarIcon />}>Unit evaluations open near the end of the semester. You will get a notification.</Empty></Card>;
  const complete = ev.questions.every((q) => ratings[q.key]);
  const submit = async () => {
    setBusy(true);
    try { await api.post(`/classes/${id}/evaluation`, { ratings, comment }); toast.show('Thank you for your feedback.', 'good'); res.reload(); }
    catch (e) { toast.show(errorText(e), 'bad'); } finally { setBusy(false); }
  };
  return (
    <Card className="stack">
      <Notice>Your lecturer never sees who wrote what. They only see combined results once enough students have responded.</Notice>
      {ev.questions.map((q) => (
        <fieldset key={q.key} className="rate">
          <legend>{q.label}</legend>
          <div className="rate-row">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className={ratings[q.key] === n ? 'on' : ''}>
                <input type="radio" name={q.key} checked={ratings[q.key] === n} onChange={() => setRatings({ ...ratings, [q.key]: n })} />
                <b>{n}</b><small>{LABELS[n - 1]}</small>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <TextArea label="Anything else you would like to say?" optional rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
      <div><Button kind="primary" busy={busy} disabled={!complete} onClick={submit}>Submit evaluation</Button></div>
    </Card>
  );
}

function Results({ id }: { id: string }) {
  const res = useGet<EvaluationResults>(`/classes/${id}/evaluation/results`);
  if (res.loading) return <Loading />;
  if (res.error || !res.data) return <ErrorNote onRetry={res.reload}>{res.error ?? 'Could not load results.'}</ErrorNote>;
  const r = res.data;
  if (r.insufficient) return <Card><Empty title="Not enough responses yet" icon={<StarIcon />}>{r.responses} of {r.enrolled} students have responded. Results appear after {r.minimum} responses so nobody can be identified.</Empty></Card>;
  return (
    <div className="stack">
      <p className="muted">{r.responses} of {r.enrolled} students responded.</p>
      <Card className="stack">
        {r.summary.map((s) => (
          <div key={s.key} className="eval-row">
            <div className="row"><span>{s.label}</span><span className="spacer" /><b className="num">{s.average.toFixed(2)} / 5</b></div>
            <div className="dist" aria-hidden="true">{s.distribution.map((n, i) => <span key={i} style={{ flexGrow: Math.max(n, 0.2) }} title={`${LABELS[i]}: ${n}`}><i style={{ height: `${Math.min(100, (n / Math.max(...s.distribution, 1)) * 100)}%` }} /></span>)}</div>
          </div>
        ))}
      </Card>
      {r.comments.length > 0 && <Card><h3>Comments</h3><ul className="comments">{r.comments.map((c, i) => <li key={i}>{c}</li>)}</ul></Card>}
    </div>
  );
}

export const EvaluationTab = ({ id, staff }: { id: string; staff: boolean }) => (staff ? <Results id={id} /> : <StudentForm id={id} />);
