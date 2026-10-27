import { useState, type FormEvent } from 'react';
import { MegaphoneIcon, TrashIcon } from '../../../components/icons';
import { Button, Card, Confirm, Empty, ErrorNote, Loading, TextArea, TextField } from '../../../components/ui';
import { dateTime } from '../../../lib/format';
import { api } from '../../../lib/singletons';
import { errorText, fieldErrors, useGet } from '../../../lib/useApi';
import { useToast } from '../../../state/toast';

interface Announcement { id: string; title: string; body: string; createdAt: string; author: string }

export function StreamTab({ id, staff }: { id: string; staff: boolean }) {
  const res = useGet<{ announcements: Announcement[] }>(`/classes/${id}/announcements`);
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [del, setDel] = useState<string | null>(null);

  const post = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrs({});
    try { await api.post(`/classes/${id}/announcements`, { title, body }); setTitle(''); setBody(''); toast.show('Announcement posted. Students have been notified.', 'good'); res.reload(); }
    catch (err) { setErrs(fieldErrors(err)); toast.show(errorText(err), 'bad'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!del) return;
    try { await api.del(`/announcements/${del}`); res.reload(); } catch (err) { toast.show(errorText(err), 'bad'); }
    setDel(null);
  };
  return (
    <div className="stack">
      {staff && (
        <Card>
          <form onSubmit={post} className="stack">
            <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={errs.title} maxLength={140} />
            <TextArea label="Message" rows={3} value={body} onChange={(e) => setBody(e.target.value)} error={errs.body} maxLength={2000} />
            <div><Button type="submit" kind="primary" busy={busy} disabled={title.trim().length < 2 || !body.trim()}>Post announcement</Button></div>
          </form>
        </Card>
      )}
      {res.loading ? <Loading /> : res.error ? <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote> : (res.data?.announcements.length ?? 0) === 0 ? (
        <Card><Empty title="No announcements yet" icon={<MegaphoneIcon />}>Notices from the lecturer will appear here.</Empty></Card>
      ) : res.data!.announcements.map((a) => (
        <Card key={a.id} className="post">
          <div className="row"><b>{a.title}</b><span className="spacer" />{staff && <button className="btn icon quiet" aria-label="Delete announcement" onClick={() => setDel(a.id)}><TrashIcon /></button>}</div>
          <p className="pre">{a.body}</p>
          <small className="muted">{a.author} · {dateTime(a.createdAt)}</small>
        </Card>
      ))}
      <Confirm open={!!del} title="Delete this announcement?" danger confirmLabel="Delete" onConfirm={remove} onClose={() => setDel(null)}>Students will no longer see it.</Confirm>
    </div>
  );
}
