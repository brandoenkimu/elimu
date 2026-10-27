import { Link } from 'react-router-dom';
import { ClipboardIcon } from '../../../components/icons';
import { Badge, Card, Empty, ErrorNote, Loading } from '../../../components/ui';
import { dateTime, relative } from '../../../lib/format';
import type { AssessmentListItem } from '../../../lib/types';
import { useGet } from '../../../lib/useApi';
import { AssessmentCreate } from './AssessmentEditor';

function studentBadge(a: AssessmentListItem) {
  const m = a.mine;
  if (!m) return a.dueAt && new Date(a.dueAt) < new Date() ? <Badge tone="bad">Missed</Badge> : <Badge tone="accent">To do</Badge>;
  if (m.status === 'in_progress') return <Badge tone="warn">In progress</Badge>;
  if (m.status === 'graded') return <Badge tone="good">{m.score !== null ? `${m.score}/${a.maxScore}` : 'Marked'}</Badge>;
  return <Badge tone="good">{m.isLate ? 'Submitted late' : 'Submitted'}</Badge>;
}

export function WorkTab({ id, staff }: { id: string; staff: boolean }) {
  const res = useGet<{ assessments: AssessmentListItem[] }>(`/classes/${id}/assessments`);
  const items = res.data?.assessments ?? [];
  return (
    <div className="stack">
      {staff && <AssessmentCreate offeringId={id} onCreated={res.reload} />}
      {res.loading ? <Loading /> : res.error ? <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote> : items.length === 0 ? (
        <Card><Empty title="No coursework yet" icon={<ClipboardIcon />}>{staff ? 'Create an assignment or an exam to get started.' : 'Assignments and exams appear here when your lecturer publishes them.'}</Empty></Card>
      ) : (
        <Card><div className="list">
          {items.map((a) => (
            <Link key={a.id} to={`work/${a.id}`} className="list-item">
              <span className={`kind-chip ${a.kind}`}>{a.kind === 'exam' ? 'Exam' : 'Assignment'}</span>
              <span className="list-main">
                <b>{a.title}</b>
                <span>
                  {a.dueAt ? `Due ${dateTime(a.dueAt)} (${relative(a.dueAt)})` : 'No deadline'}
                  {a.durationMin ? ` · ${a.durationMin} min` : ''} · {a.maxScore} marks{a.weight ? ` · ${a.weight}% of grade` : ''}
                </span>
              </span>
              {staff ? (
                <>
                  {a.status === 'draft' && <Badge tone="warn">Draft</Badge>}
                  {a.status === 'closed' && <Badge>Closed</Badge>}
                  {a.status === 'published' && <Badge tone="accent">{a.submitted ?? 0} submitted</Badge>}
                </>
              ) : studentBadge(a)}
            </Link>
          ))}
        </div></Card>
      )}
    </div>
  );
}
