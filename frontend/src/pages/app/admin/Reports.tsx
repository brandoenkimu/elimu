import { DownloadIcon } from '../../../components/icons';
import { Button, Card, ErrorNote, Loading, PageHeader } from '../../../components/ui';
import { api } from '../../../lib/singletons';
import type { AdminOffering, Term } from '../../../lib/types';
import { errorText, useGet } from '../../../lib/useApi';
import { useToast } from '../../../state/toast';
import { useState } from 'react';

export default function Reports() {
  const toast = useToast();
  const terms = useGet<{ terms: Term[] }>('/admin/terms');
  const current = terms.data?.terms.find((t) => t.isCurrent);
  const offerings = useGet<{ offerings: AdminOffering[] }>(current ? `/admin/offerings?termId=${current.id}` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const dl = async (path: string, name: string) => {
    setBusy(path);
    try { await api.download(path, name); } catch (e) { toast.show(errorText(e), 'bad'); } finally { setBusy(null); }
  };
  if (terms.loading && !terms.data) return <Loading />;
  if (terms.error) return <ErrorNote onRetry={terms.reload}>{terms.error}</ErrorNote>;
  return (
    <>
      <PageHeader title="Reports" sub="Download lists as CSV. Open them in Excel or Google Sheets." />
      <div className="grid cols-2">
        <Card className="stack"><h3>All students</h3><p className="muted">Name, registration number, email, course, year and status.</p><div><Button busy={busy === '/admin/reports/students.csv'} onClick={() => dl('/admin/reports/students.csv', 'students.csv')}><DownloadIcon /> Download CSV</Button></div></Card>
        <Card className="stack"><h3>All lecturers</h3><p className="muted">Name, staff number, email, department and status.</p><div><Button busy={busy === '/admin/reports/lecturers.csv'} onClick={() => dl('/admin/reports/lecturers.csv', 'lecturers.csv')}><DownloadIcon /> Download CSV</Button></div></Card>
      </div>
      <div className="section-title"><h2>Class lists{current ? ` · ${current.name}` : ''}</h2></div>
      <Card>
        {(offerings.data?.offerings.length ?? 0) === 0 ? <p className="muted">No classes are scheduled in the current semester.</p> : (
          <div className="list">{offerings.data!.offerings.map((o) => (
            <div key={o.id} className="list-item"><span className="code-chip">{o.unitCode}</span><span className="list-main"><b>{o.unitName}</b><span>{o.lecturerName ?? 'No lecturer'} · {o.enrolled} student{o.enrolled === 1 ? '' : 's'}</span></span>
              <Button size="sm" busy={busy === `/classes/${o.id}/roster.csv`} onClick={() => dl(`/classes/${o.id}/roster.csv`, `${o.unitCode}-class-list.csv`)}><DownloadIcon /> Class list</Button></div>
          ))}</div>
        )}
      </Card>
    </>
  );
}
