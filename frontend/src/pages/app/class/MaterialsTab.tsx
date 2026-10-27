import { useRef, useState, type FormEvent } from 'react';
import { DownloadIcon, FileIcon, TrashIcon, UploadIcon } from '../../../components/icons';
import { Button, Card, Confirm, Empty, ErrorNote, Loading, TextField } from '../../../components/ui';
import { dateTime, fileSize } from '../../../lib/format';
import { api } from '../../../lib/singletons';
import type { FileMeta } from '../../../lib/types';
import { errorText, fieldErrors, useGet } from '../../../lib/useApi';
import { useToast } from '../../../state/toast';

interface Material { id: string; title: string; description: string; createdAt: string; fileId: string; fileName: string; fileSize: number }

export function MaterialsTab({ id, staff }: { id: string; staff: boolean }) {
  const res = useGet<{ materials: Material[] }>(`/classes/${id}/materials`);
  const rules = useGet<{ extensions: string[]; maxBytes: number }>(staff ? '/files/rules' : null);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<FileMeta | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [del, setDel] = useState<string | null>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try { const meta = await api.upload(f); setFile(meta); if (!title) setTitle(f.name.replace(/\.[^.]+$/, '')); }
    catch (err) { toast.show(errorText(err), 'bad'); }
    finally { setUploading(false); if (input.current) input.current.value = ''; }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setErrs({});
    try { await api.post(`/classes/${id}/materials`, { title, description, fileId: file.id }); setFile(null); setTitle(''); setDescription(''); toast.show('Material added.', 'good'); res.reload(); }
    catch (err) { setErrs(fieldErrors(err)); toast.show(errorText(err), 'bad'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!del) return;
    try { await api.del(`/materials/${del}`); res.reload(); } catch (err) { toast.show(errorText(err), 'bad'); }
    setDel(null);
  };
  return (
    <div className="stack">
      {staff && (
        <Card>
          <form onSubmit={add} className="stack">
            <div className="row wrap">
              <input ref={input} type="file" hidden onChange={(e) => pick(e.target.files?.[0])} />
              <Button onClick={() => input.current?.click()} busy={uploading}><UploadIcon /> {file ? 'Choose a different file' : 'Choose a file'}</Button>
              {file ? <span className="file-pill"><FileIcon /> {file.name} · {fileSize(file.size)}</span> : <small className="muted">{rules.data ? `Up to ${fileSize(rules.data.maxBytes)}. ${rules.data.extensions.join(', ')}` : 'Notes, slides, past papers'}</small>}
            </div>
            <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={errs.title} maxLength={140} />
            <TextField label="Description" optional value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
            <div><Button type="submit" kind="primary" busy={busy} disabled={!file || title.trim().length < 2}>Share with class</Button></div>
          </form>
        </Card>
      )}
      {res.loading ? <Loading /> : res.error ? <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote> : (res.data?.materials.length ?? 0) === 0 ? (
        <Card><Empty title="No materials yet" icon={<FileIcon />}>Notes and slides shared by the lecturer will be listed here.</Empty></Card>
      ) : (
        <Card><div className="list">
          {res.data!.materials.map((m) => (
            <div key={m.id} className="list-item">
              <span className="stat-icon"><FileIcon /></span>
              <span className="list-main"><b>{m.title}</b><span>{m.description || m.fileName} · {fileSize(m.fileSize)} · {dateTime(m.createdAt)}</span></span>
              <Button size="sm" onClick={() => api.download(`/files/${m.fileId}`, m.fileName).catch((e) => toast.show(errorText(e), 'bad'))}><DownloadIcon /> Download</Button>
              {staff && <button className="btn icon quiet" aria-label="Remove material" onClick={() => setDel(m.id)}><TrashIcon /></button>}
            </div>
          ))}
        </div></Card>
      )}
      <Confirm open={!!del} title="Remove this material?" danger confirmLabel="Remove" onConfirm={remove} onClose={() => setDel(null)}>Students will no longer be able to download it.</Confirm>
    </div>
  );
}
