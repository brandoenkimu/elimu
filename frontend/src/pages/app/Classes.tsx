import { Link } from 'react-router-dom';
import { BookIcon } from '../../components/icons';
import { Card, Empty, ErrorNote, Loading, PageHeader } from '../../components/ui';
import type { ClassInfo } from '../../lib/types';
import { useGet } from '../../lib/useApi';
import { useSession } from '../../state/session';
import { ClassCard } from './Home';

export default function Classes() {
  const { user } = useSession();
  const res = useGet<{ classes: ClassInfo[] }>('/classes');
  const lecturer = user!.role !== 'student';
  const all = res.data?.classes ?? [];
  const current = all.filter((c) => c.isCurrentTerm);
  const past = all.filter((c) => !c.isCurrentTerm);
  return (
    <>
      <PageHeader title={lecturer ? 'My classes' : 'My units'} sub={lecturer ? 'Classes you teach' : 'Units you are registered for'}
        actions={!lecturer && <Link className="btn primary" to="/app/registration">Register units</Link>} />
      {res.loading ? <Loading /> : res.error ? <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote> : all.length === 0 ? (
        <Card><Empty title="Nothing here yet" icon={<BookIcon />}>{lecturer ? 'Classes appear once an administrator assigns you to a unit.' : 'Register your units to see them here.'}</Empty></Card>
      ) : (
        <>
          {current.length > 0 && <><div className="section-title"><h2>This semester</h2></div><div className="grid auto">{current.map((c) => <ClassCard key={c.id} c={c} lecturer={lecturer} />)}</div></>}
          {past.length > 0 && <><div className="section-title"><h2>Earlier semesters</h2></div><div className="grid auto">{past.map((c) => <ClassCard key={c.id} c={c} lecturer={lecturer} />)}</div></>}
        </>
      )}
    </>
  );
}
