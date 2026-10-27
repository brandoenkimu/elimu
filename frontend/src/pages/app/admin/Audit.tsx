import { useState } from 'react';
import { Button, Card, Empty, ErrorNote, Loading, PageHeader } from '../../../components/ui';
import { dateTime } from '../../../lib/format';
import { api } from '../../../lib/singletons';
import type { AuditEntry } from '../../../lib/types';
import { errorText, useGet } from '../../../lib/useApi';

export default function Audit() {
  const first = useGet<{ entries: AuditEntry[] }>('/admin/audit?limit=50');
  const [more, setMore] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const all = [...(first.data?.entries ?? []), ...more];
  const last = all[all.length - 1];
  const load = async () => {
    if (!last) return;
    setBusy(true); setErr(null);
    try { const r = await api.get<{ entries: AuditEntry[] }>(`/admin/audit?limit=50&before=${last.id}`); setMore((m) => [...m, ...r.entries]); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Activity log" sub="Every administrative change, who made it and when." />
      {first.loading ? <Loading /> : first.error ? <ErrorNote onRetry={first.reload}>{first.error}</ErrorNote> : all.length === 0 ? <Card><Empty title="Nothing recorded yet" /></Card> : (
        <Card><div className="table-wrap"><table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
          <tbody>{all.map((e) => (
            <tr key={e.id}><td>{dateTime(e.createdAt)}</td><td>{e.actorName}</td><td><code>{e.action}</code></td><td>{e.targetType}</td><td className="detail">{Object.keys(e.detail).length ? JSON.stringify(e.detail) : ''}</td></tr>
          ))}</tbody>
        </table></div></Card>
      )}
      {err && <ErrorNote>{err}</ErrorNote>}
      {all.length >= 50 && <div style={{ marginTop: 12 }}><Button busy={busy} onClick={load}>Load older</Button></div>}
    </>
  );
}
