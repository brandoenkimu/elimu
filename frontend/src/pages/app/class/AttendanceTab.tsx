import { useState, type FormEvent } from 'react';
import { CheckIcon, DownloadIcon, TimerIcon } from '../../../components/icons';
import { Avatar } from '../../../components/bits';
import { Badge, Button, Card, Empty, ErrorNote, Loading, Modal, TextField } from '../../../components/ui';
import { dateTime, relative } from '../../../lib/format';
import { api } from '../../../lib/singletons';
import type { AttendanceSessionT } from '../../../lib/types';
import { errorText, useGet } from '../../../lib/useApi';
import { useToast } from '../../../state/toast';

interface RosterRow { id: string; name: string; regNumber: string | null; present: boolean; checkedInAt: string | null; method: string | null }

function SessionRoster({ sessionId, onClose }: { sessionId: string; onClose(): void }) {
  const res = useGet<{ session: { title: string }; students: RosterRow[] }>(`/attendance/${sessionId}`);
  const toast = useToast();
  const mark = async (s: RosterRow, present: boolean) => {
    try { await api.put(`/attendance/${sessionId}/students/${s.id}`, { present }); res.reload(); } catch (e) { toast.show(errorText(e), 'bad'); }
  };
  const rows = res.data?.students ?? [];
  return (
    <Modal open onClose={onClose} title={res.data?.session.title ?? 'Attendance'} wide
      footer={<><Button onClick={() => api.download(`/attendance/${sessionId}/export.csv`, 'attendance.csv').catch((e) => toast.show(errorText(e), 'bad'))}><DownloadIcon /> Export CSV</Button><Button kind="primary" onClick={onClose}>Done</Button></>}>
      {res.loading ? <Loading /> : res.error ? <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote> : (
        <>
          <p className="muted">{rows.filter((r) => r.present).length} of {rows.length} present. Tap a student to correct a check-in.</p>
          <div className="list">
            {rows.map((r) => (
              <div key={r.id} className="list-item">
                <Avatar name={r.name} size={32} />
                <span className="list-main"><b>{r.name}</b><span>{r.regNumber ?? 'No registration number'}{r.checkedInAt ? ` · ${dateTime(r.checkedInAt)}` : ''}</span></span>
                <Button size="sm" kind={r.present ? 'primary' : undefined} onClick={() => mark(r, !r.present)}>{r.present ? <><CheckIcon /> Present</> : 'Absent'}</Button>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

export function AttendanceTab({ id, staff }: { id: string; staff: boolean }) {
  const res = useGet<{ sessions: AttendanceSessionT[] }>(`/classes/${id}/attendance`);
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState('15');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const sessions = res.data?.sessions ?? [];

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await api.post(`/classes/${id}/attendance`, { title, minutes: Number(minutes) || 15 }); setTitle(''); res.reload(); toast.show('Check-in is open. Show the code to the class.', 'good'); }
    catch (err) { toast.show(errorText(err), 'bad'); } finally { setBusy(false); }
  };
  const checkIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { const r = await api.post<{ title: string; alreadyCheckedIn: boolean }>(`/classes/${id}/checkin`, { code }); setCode(''); toast.show(r.alreadyCheckedIn ? 'You were already checked in.' : `Checked in to ${r.title}.`, 'good'); res.reload(); }
    catch (err) { toast.show(errorText(err), 'bad'); } finally { setBusy(false); }
  };
  const close = async (sid: string) => { try { await api.post(`/attendance/${sid}/close`); res.reload(); } catch (e) { toast.show(errorText(e), 'bad'); } };

  const live = sessions.filter((s) => s.live);
  return (
    <div className="stack">
      {staff ? (
        <Card>
          <form onSubmit={start} className="row wrap end">
            <TextField label="Session title" placeholder="e.g. Week 4 lecture" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
            <TextField label="Open for (minutes)" type="number" min={1} max={180} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            <Button type="submit" kind="primary" busy={busy} disabled={title.trim().length < 2}><TimerIcon /> Open check-in</Button>
          </form>
        </Card>
      ) : live.length > 0 ? (
        <Card>
          <form onSubmit={checkIn} className="row wrap end">
            <TextField label={`Check-in code for ${live[0].title}`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <Button type="submit" kind="primary" busy={busy} disabled={code.length !== 6}>Check in</Button>
          </form>
        </Card>
      ) : null}

      {res.loading ? <Loading /> : res.error ? <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote> : sessions.length === 0 ? (
        <Card><Empty title="No sessions yet" icon={<TimerIcon />}>{staff ? 'Open a check-in at the start of a lecture. Students enter the code to be marked present.' : 'When your lecturer opens a check-in you will be able to enter the code here.'}</Empty></Card>
      ) : (
        <Card><div className="list">
          {sessions.map((s) => (
            <div key={s.id} className="list-item">
              <span className="list-main"><b>{s.title}</b><span>{dateTime(s.opensAt)}{s.live ? ` · closes ${relative(s.closesAt)}` : ''}</span></span>
              {staff ? (
                <>
                  {s.live && s.code && <span className="code-big" aria-label={`Code ${s.code}`}>{s.code}</span>}
                  <Badge tone={s.live ? 'good' : 'neutral'}>{s.live ? 'Open' : 'Closed'}</Badge>
                  <Badge>{Number(s.present ?? 0)}/{s.total ?? 0}</Badge>
                  {s.live && <Button size="sm" onClick={() => close(s.id)}>Close</Button>}
                  <Button size="sm" onClick={() => setOpen(s.id)}>Roster</Button>
                </>
              ) : s.present ? <Badge tone="good">Present</Badge> : s.live ? <Badge tone="warn">Open</Badge> : <Badge tone="bad">Absent</Badge>}
            </div>
          ))}
        </div></Card>
      )}
      {open && <SessionRoster sessionId={open} onClose={() => { setOpen(null); res.reload(); }} />}
    </div>
  );
}
