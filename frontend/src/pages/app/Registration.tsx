import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Check, Empty, ErrorNote, Loading, Notice, PageHeader } from '../../components/ui';
import { BookIcon } from '../../components/icons';
import { api } from '../../lib/singletons';
import type { RegistrationOverview } from '../../lib/types';
import { errorText, useGet } from '../../lib/useApi';
import { useSession } from '../../state/session';
import { useToast } from '../../state/toast';

export default function Registration() {
  const res = useGet<RegistrationOverview>('/registration');
  const { user } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const welcome = (useLocation().state as { welcome?: boolean } | null)?.welcome;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (res.data) setPicked(new Set(res.data.offerings.filter((o) => o.registered).map((o) => o.id))); }, [res.data]);

  if (res.loading && !res.data) return <Loading />;
  if (res.error || !res.data) return <ErrorNote onRetry={res.reload}>{res.error ?? 'Could not load registration.'}</ErrorNote>;
  const r = res.data;
  const registered = new Set(r.offerings.filter((o) => o.registered).map((o) => o.id));
  const toAdd = [...picked].filter((id) => !registered.has(id));
  const toDrop = [...registered].filter((id) => !picked.has(id));
  const credits = r.offerings.filter((o) => picked.has(o.id)).reduce((n, o) => n + o.creditHours, 0);

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = async () => {
    setBusy(true);
    try {
      for (const id of toDrop) await api.del(`/registration/${id}`);
      if (toAdd.length) await api.post('/registration', { offeringIds: toAdd });
      toast.show('Your units are saved.', 'good');
      if (toAdd.length) nav('/app/classes'); else res.reload();
    } catch (e) { toast.show(errorText(e), 'bad'); res.reload(); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Unit registration" sub={r.term ? `${r.term.name}${user?.courseName ? ` · ${user.courseName}` : ''}${r.yearOfStudy ? ` · Year ${r.yearOfStudy}` : ''}` : undefined} />
      {welcome && <Notice tone="good">Welcome to Elimu. Choose the units you are taking this semester to join their class groups.</Notice>}
      {!r.hasCourse ? <Card><Empty title="Choose your course first" icon={<BookIcon />} action={<Link className="btn primary" to="/app/settings/profile">Open profile</Link>}>Your course decides which units you can register for.</Empty></Card>
        : !r.term ? <Card><Empty title="No active semester" icon={<BookIcon />}>Your administrator has not started a semester yet.</Empty></Card>
        : r.offerings.length === 0 ? <Card><Empty title="No units are available" icon={<BookIcon />}>There are no units scheduled for your course this semester yet. Check back soon.</Empty></Card>
        : (
          <div className="stack">
            {!r.registrationOpen && <Notice tone="warn">Registration is closed. You can see your units but cannot change them. Contact your administrator if something is wrong.</Notice>}
            <Card><div className="list">
              {r.offerings.map((o) => {
                const full = o.capacity !== null && o.enrolled >= o.capacity && !o.registered;
                return (
                  <label key={o.id} className="list-item reg-row">
                    <Check checked={picked.has(o.id)} onChange={() => toggle(o.id)}><span className="sr-only">Register for {o.unitName}</span></Check>
                    <span className="code-chip">{o.unitCode}</span>
                    <span className="list-main"><b>{o.unitName}</b><span>Year {o.yearOfStudy}, Semester {o.semester} · {o.creditHours} credit hours{o.lecturerName ? ` · ${o.lecturerTitle ? o.lecturerTitle + ' ' : ''}${o.lecturerName}` : ' · lecturer to be assigned'}</span></span>
                    {full ? <Badge tone="bad">Full</Badge> : o.capacity ? <Badge>{o.capacity - o.enrolled} seats left</Badge> : null}
                  </label>
                );
              })}
            </div></Card>
            <div className="sticky-actions">
              <span className="muted">{picked.size} unit{picked.size === 1 ? '' : 's'} · {credits} credit hours</span><span className="spacer" />
              <Button kind="primary" busy={busy} disabled={!r.registrationOpen || (toAdd.length === 0 && toDrop.length === 0)} onClick={save}>Save registration</Button>
            </div>
          </div>
        )}
    </>
  );
}
