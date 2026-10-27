import { useState } from 'react';
import { Card, Empty, ErrorNote, Loading, PageHeader, SelectField } from '../../components/ui';
import { AwardIcon } from '../../components/icons';
import type { ClassInfo } from '../../lib/types';
import { useGet } from '../../lib/useApi';
import { GradebookView } from './class/GradesTab';

export default function Gradebooks() {
  const res = useGet<{ classes: ClassInfo[] }>('/classes');
  const [sel, setSel] = useState('');
  if (res.loading) return <Loading />;
  if (res.error) return <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote>;
  const list = res.data?.classes ?? [];
  const cur = list.find((c) => c.id === sel) ?? list.find((c) => c.isCurrentTerm) ?? list[0];
  return (
    <>
      <PageHeader title="Gradebooks" sub="Marks, weighted totals and attendance for each class." />
      {!cur ? <Card><Empty title="No classes yet" icon={<AwardIcon />}>Gradebooks appear once you are assigned to a unit.</Empty></Card> : (
        <div className="stack">
          <SelectField label="Class" value={cur.id} onChange={(e) => setSel(e.target.value)}>
            {list.map((c) => <option key={c.id} value={c.id}>{c.unitCode} · {c.unitName} ({c.termName})</option>)}
          </SelectField>
          <GradebookView key={cur.id} id={cur.id} title={`${cur.unitCode} ${cur.unitName}: gradebook`} />
        </div>
      )}
    </>
  );
}
