import { DownloadIcon, PrintIcon, UsersIcon } from '../../../components/icons';
import { Avatar } from '../../../components/bits';
import { Button, Card, Empty, ErrorNote, Loading } from '../../../components/ui';
import { fullDate } from '../../../lib/format';
import { printTable } from '../../../lib/print';
import { api } from '../../../lib/singletons';
import type { ClassInfo, RosterStudent } from '../../../lib/types';
import { errorText, useGet } from '../../../lib/useApi';
import { useToast } from '../../../state/toast';

export function RosterTab({ info }: { info: ClassInfo }) {
  const res = useGet<{ students: RosterStudent[] }>(`/classes/${info.id}/roster`);
  const toast = useToast();
  if (res.loading) return <Loading />;
  if (res.error || !res.data) return <ErrorNote onRetry={res.reload}>{res.error ?? 'Could not load the class list.'}</ErrorNote>;
  const rows = res.data.students;
  const print = () => printTable({
    title: `${info.unitCode} ${info.unitName}: class list`, subtitle: `${info.termName} · ${rows.length} registered students`,
    header: ['#', 'Reg. no.', 'Name', 'Year', 'Email'], rows: rows.map((s, i) => [i + 1, s.regNumber ?? '', s.displayName, s.yearOfStudy ?? '', s.email]),
  });
  return (
    <div className="stack">
      <div className="row wrap"><span className="muted">{rows.length} registered student{rows.length === 1 ? '' : 's'}{info.capacity ? ` of ${info.capacity} seats` : ''}</span><span className="spacer" />
        <Button onClick={print} disabled={!rows.length}><PrintIcon /> Print</Button>
        <Button onClick={() => api.download(`/classes/${info.id}/roster.csv`, 'class-list.csv').catch((e) => toast.show(errorText(e), 'bad'))} disabled={!rows.length}><DownloadIcon /> CSV</Button></div>
      {rows.length === 0 ? <Card><Empty title="No registered students yet" icon={<UsersIcon />}>Students appear here as they register for this unit.</Empty></Card> : (
        <Card><div className="table-wrap"><table className="table">
          <thead><tr><th>#</th><th>Reg. no.</th><th>Student</th><th>Year</th><th>Registered</th></tr></thead>
          <tbody>{rows.map((s, i) => (
            <tr key={s.id}><td>{i + 1}</td><td>{s.regNumber ?? '—'}</td><td><span className="row"><Avatar name={s.displayName} size={28} /><span><b>{s.displayName}</b><br /><small className="muted">{s.email}</small></span></span></td><td>{s.yearOfStudy ?? '—'}</td><td>{fullDate(s.enrolledAt)}</td></tr>
          ))}</tbody>
        </table></div></Card>
      )}
    </div>
  );
}
