import { Link } from 'react-router-dom';
import { Card, Empty, ErrorNote, Loading, PageHeader } from '../../components/ui';
import { AwardIcon } from '../../components/icons';
import type { ClassInfo, MyGrades } from '../../lib/types';
import { useGet } from '../../lib/useApi';
import { api } from '../../lib/singletons';
import { useEffect, useState } from 'react';

export default function Grades() {
  const classes = useGet<{ classes: ClassInfo[] }>('/classes');
  const [rows, setRows] = useState<Record<string, MyGrades>>({});
  useEffect(() => {
    for (const c of classes.data?.classes ?? []) api.get<MyGrades>(`/classes/${c.id}/my-grades`).then((g) => setRows((r) => ({ ...r, [c.id]: g }))).catch(() => undefined);
  }, [classes.data]);
  if (classes.loading) return <Loading />;
  if (classes.error) return <ErrorNote onRetry={classes.reload}>{classes.error}</ErrorNote>;
  const list = classes.data?.classes ?? [];
  return (
    <>
      <PageHeader title="My results" sub="Only results your lecturers have released are shown." />
      {list.length === 0 ? <Card><Empty title="No units yet" icon={<AwardIcon />}>Register for your units to see results here.</Empty></Card> : (
        <Card><div className="table-wrap"><table className="table">
          <thead><tr><th>Unit</th><th>Semester</th><th className="r">Total</th><th>Grade</th><th className="r">Attendance</th></tr></thead>
          <tbody>{list.map((c) => { const g = rows[c.id]; return (
            <tr key={c.id}><td><Link to={`/app/classes/${c.id}?tab=grades`}><span className="code-chip">{c.unitCode}</span> {c.unitName}</Link></td><td>{c.termName}</td>
              <td className="r">{g?.total.percent != null ? `${g.total.percent.toFixed(1)}%` : '—'}</td><td>{g?.total.letter ?? '—'}</td>
              <td className="r">{g?.attendancePercent != null ? `${Math.round(g.attendancePercent)}%` : '—'}</td></tr>
          ); })}</tbody>
        </table></div></Card>
      )}
    </>
  );
}
