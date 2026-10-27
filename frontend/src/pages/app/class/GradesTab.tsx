import { DownloadIcon, PrintIcon } from '../../../components/icons';
import { Badge, Button, Card, Empty, ErrorNote, Loading, Progress } from '../../../components/ui';
import { api } from '../../../lib/singletons';
import { printTable } from '../../../lib/print';
import type { Gradebook, MyGrades } from '../../../lib/types';
import { errorText, useGet } from '../../../lib/useApi';
import { useToast } from '../../../state/toast';

const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);

export function MyGradesView({ id }: { id: string }) {
  const res = useGet<MyGrades>(`/classes/${id}/my-grades`);
  if (res.loading) return <Loading />;
  if (res.error || !res.data) return <ErrorNote onRetry={res.reload}>{res.error ?? 'Could not load your grades.'}</ErrorNote>;
  const g = res.data;
  return (
    <div className="stack">
      <div className="grid cols-3">
        <Card><div className="stat-label">Weighted total</div><div className="stat-value">{pct(g.total.percent)}</div><small className="muted">Based on released results only</small></Card>
        <Card><div className="stat-label">Grade</div><div className="stat-value">{g.total.letter ?? '—'}</div></Card>
        <Card><div className="stat-label">Attendance</div><div className="stat-value">{g.attendancePercent === null ? '—' : `${Math.round(g.attendancePercent)}%`}</div>{g.attendancePercent !== null && <Progress value={g.attendancePercent} label="Attendance" />}</Card>
      </div>
      {g.items.length === 0 ? <Card><Empty title="Nothing to show yet">Coursework appears here once it is published.</Empty></Card> : (
        <Card><div className="table-wrap"><table className="table">
          <thead><tr><th>Coursework</th><th>Weight</th><th className="r">Score</th><th>Status</th></tr></thead>
          <tbody>{g.items.map((i) => (
            <tr key={i.assessmentId}><td>{i.title}</td><td>{i.weight}%</td>
              <td className="r">{i.score !== null && i.resultsReleased ? `${i.score} / ${i.maxScore}` : '—'}</td>
              <td>{i.status === 'graded' ? (i.resultsReleased ? <Badge tone="good">Released</Badge> : <Badge tone="warn">Awaiting release</Badge>) : i.status === 'submitted' ? <Badge>Submitted</Badge> : <Badge tone="neutral">Not submitted</Badge>}</td></tr>
          ))}</tbody>
        </table></div></Card>
      )}
    </div>
  );
}

export function GradebookView({ id, title }: { id: string; title?: string }) {
  const res = useGet<Gradebook>(`/classes/${id}/gradebook`);
  const toast = useToast();
  if (res.loading) return <Loading />;
  if (res.error || !res.data) return <ErrorNote onRetry={res.reload}>{res.error ?? 'Could not load the gradebook.'}</ErrorNote>;
  const g = res.data;
  const header = ['Reg. no.', 'Name', ...g.columns.map((c) => `${c.title} (/${c.maxScore})`), 'Total %', 'Grade', 'Attendance %'];
  const rows = g.students.map((s) => [s.regNumber ?? '', s.name, ...g.columns.map((c) => { const x = s.scores.find((y) => y.assessmentId === c.id); return x?.score ?? ''; }), s.total.percent === null ? '' : s.total.percent.toFixed(1), s.total.letter ?? '', s.attendancePercent === null ? '' : Math.round(s.attendancePercent)]);
  return (
    <div className="stack">
      <div className="row wrap">
        <span className="muted">{g.students.length} students · scores show your marks; students see them only after release.</span><span className="spacer" />
        <Button onClick={() => printTable({ title: title ?? 'Gradebook', subtitle: `${g.students.length} students`, header, rows })}><PrintIcon /> Print</Button>
        <Button onClick={() => api.download(`/classes/${id}/gradebook.csv`, 'gradebook.csv').catch((e) => toast.show(errorText(e), 'bad'))}><DownloadIcon /> CSV</Button>
      </div>
      {g.students.length === 0 ? <Card><Empty title="No students yet">The gradebook fills in as students register for this unit.</Empty></Card> : (
        <Card><div className="table-wrap"><table className="table">
          <thead><tr><th>Reg. no.</th><th>Name</th>{g.columns.map((c) => <th key={c.id} className="r" title={`${c.weight}% of grade`}>{c.title}<small> /{c.maxScore}</small></th>)}<th className="r">Total</th><th>Grade</th><th className="r">Attend.</th></tr></thead>
          <tbody>{g.students.map((s) => (
            <tr key={s.id}><td>{s.regNumber ?? '—'}</td><td>{s.name}</td>
              {g.columns.map((c) => { const x = s.scores.find((y) => y.assessmentId === c.id); return <td key={c.id} className="r">{x?.score ?? <span className="muted">{x?.status === 'submitted' ? 'to mark' : '—'}</span>}</td>; })}
              <td className="r"><b>{pct(s.total.percent)}</b></td><td>{s.total.letter ?? '—'}</td><td className="r">{s.attendancePercent === null ? '—' : `${Math.round(s.attendancePercent)}%`}</td></tr>
          ))}</tbody>
        </table></div></Card>
      )}
    </div>
  );
}

export const GradesTab = ({ id, staff }: { id: string; staff: boolean }) => (staff ? <GradebookView id={id} /> : <MyGradesView id={id} />);
