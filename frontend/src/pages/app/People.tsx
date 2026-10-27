import { useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Avatar, RoleTag } from '../../components/bits';
import { BackIcon, BanIcon, CheckIcon, ChatIcon, MailIcon, PinIcon, SearchIcon, UserPlusIcon, UsersIcon } from '../../components/icons';
import { Badge, Button, Card, Confirm, Empty, ErrorNote, Loading, PageHeader, Segmented, Tabs, useDebounced } from '../../components/ui';
import { fullDate, yearLabel } from '../../lib/format';
import { api } from '../../lib/singletons';
import type { ConnectionItem, PersonCard, PublicProfile, Relation } from '../../lib/types';
import { errorText, useGet } from '../../lib/useApi';
import { useChat } from '../../state/chat';
import { useToast } from '../../state/toast';

/** Everything you can do with one person, driven by how you are related to them. */
function useRelationActions(onChanged: () => void) {
  const toast = useToast();
  const chat = useChat();
  const nav = useNavigate();
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast.show(ok, 'good'); onChanged(); } catch (e) { toast.show(errorText(e), 'bad'); }
  };
  return {
    connect: (id: string) => run(() => api.post('/connections', { userId: id, note: '' }), 'Request sent.'),
    accept: (cid: string) => run(() => api.post(`/connections/${cid}/accept`), 'You are now connected.'),
    decline: (cid: string) => run(() => api.post(`/connections/${cid}/decline`)),
    cancel: (cid: string) => run(() => api.del(`/connections/${cid}`)),
    block: (id: string) => run(() => api.post(`/connections/block/${id}`), 'Blocked.'),
    unblock: (id: string) => run(() => api.del(`/connections/block/${id}`), 'Unblocked.'),
    message: async (id: string) => { try { const cid = await chat.openDirect(id); nav(`/app/messages/${cid}`); } catch (e) { toast.show(errorText(e), 'bad'); } },
  };
}

const subline = (p: PersonCard) => p.role === 'lecturer' ? [p.title, p.department].filter(Boolean).join(' · ') || 'Lecturer' : [p.courseName, yearLabel(p.yearOfStudy)].filter(Boolean).join(' · ') || 'Student';

function RelationButtons({ p, relation, connectionId, a, large }: { p: PersonCard; relation: Relation; connectionId: string | null | undefined; a: ReturnType<typeof useRelationActions>; large?: boolean }) {
  const size = large ? 'md' : 'sm';
  return (
    <span className="row wrap">
      {relation === 'none' && <Button size={size} kind="primary" onClick={() => a.connect(p.id)}><UserPlusIcon /> Connect</Button>}
      {relation === 'outgoing' && connectionId && <Button size={size} onClick={() => a.cancel(connectionId)}>Requested · Cancel</Button>}
      {relation === 'incoming' && connectionId && <><Button size={size} kind="primary" onClick={() => a.accept(connectionId)}><CheckIcon /> Accept</Button><Button size={size} onClick={() => a.decline(connectionId)}>Decline</Button></>}
      {(relation === 'friends' || p.role === 'lecturer') && relation !== 'blocked' && relation !== 'blocked_by_me' && <Button size={size} kind={relation === 'friends' ? 'primary' : undefined} onClick={() => a.message(p.id)}><ChatIcon /> Message</Button>}
      {relation === 'blocked_by_me' && <Button size={size} onClick={() => a.unblock(p.id)}>Unblock</Button>}
    </span>
  );
}

function PersonRow({ p, a }: { p: PersonCard; a: ReturnType<typeof useRelationActions> }) {
  return (
    <div className="list-item person">
      <Link to={`/app/people/${p.id}`}><Avatar name={p.displayName} size={44} /></Link>
      <span className="list-main"><Link to={`/app/people/${p.id}`}><b>{p.displayName}</b></Link><span>{subline(p)}</span></span>
      <RoleTag role={p.role} />
      <RelationButtons p={p} relation={p.relation ?? 'none'} connectionId={p.connectionId} a={a} />
    </div>
  );
}

function Discover() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState<'all' | 'student' | 'lecturer'>('all');
  const term = useDebounced(q.trim(), 350);
  const search = useGet<{ people: PersonCard[] }>(term.length >= 2 ? `/people/search?q=${encodeURIComponent(term)}${role === 'all' ? '' : `&role=${role}`}` : null);
  const sugg = useGet<{ people: PersonCard[] }>('/people/suggestions');
  const refresh = () => { search.reload(); sugg.reload(); };
  const a = useRelationActions(refresh);
  const searching = term.length >= 2;
  return (
    <div className="stack">
      <div className="row wrap">
        <label className="search grow"><SearchIcon /><input placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" /></label>
        <Segmented<'all' | 'student' | 'lecturer'> label="Show" value={role} onChange={setRole} options={[{ value: 'all', label: 'Everyone' }, { value: 'student', label: 'Students' }, { value: 'lecturer', label: 'Lecturers' }]} />
      </div>
      {searching ? (
        search.loading ? <Loading /> : search.error ? <ErrorNote onRetry={search.reload}>{search.error}</ErrorNote> :
        (search.data?.people.length ?? 0) === 0 ? <Card><Empty title="No one found" icon={<SearchIcon />}>Try a different spelling, or a shorter name.</Empty></Card> :
        <Card><div className="list">{search.data!.people.map((p) => <PersonRow key={p.id} p={p} a={a} />)}</div></Card>
      ) : (
        <>
          <div className="section-title"><h2>People you may know</h2></div>
          {sugg.loading ? <Loading /> : (sugg.data?.people.length ?? 0) === 0 ? <Card><Empty title="No suggestions yet" icon={<UsersIcon />}>Register for your units and you will see classmates and lecturers here. You can also search by name.</Empty></Card> :
            <Card><div className="list">{sugg.data!.people.map((p) => <PersonRow key={p.id} p={p} a={a} />)}</div></Card>}
        </>
      )}
    </div>
  );
}

function Requests({ mode }: { mode: 'requests' | 'friends' }) {
  const res = useGet<{ connections: ConnectionItem[]; blocked: PersonCard[] }>('/connections');
  const a = useRelationActions(res.reload);
  if (res.loading && !res.data) return <Loading />;
  if (res.error || !res.data) return <ErrorNote onRetry={res.reload}>{res.error ?? 'Could not load.'}</ErrorNote>;
  const pending = res.data.connections.filter((c) => c.status === 'pending');
  const friends = res.data.connections.filter((c) => c.status === 'accepted');
  const incoming = pending.filter((c) => c.direction === 'incoming');
  const outgoing = pending.filter((c) => c.direction === 'outgoing');
  if (mode === 'friends') {
    return (
      <div className="stack">
        {friends.length === 0 ? <Card><Empty title="No connections yet" icon={<UsersIcon />}>Connect with classmates to chat privately. Lecturers can always be messaged directly.</Empty></Card> :
          <Card><div className="list">{friends.map((c) => <PersonRow key={c.id} p={{ ...c.user, relation: 'friends', connectionId: c.id }} a={a} />)}</div></Card>}
        {res.data.blocked.length > 0 && <><div className="section-title"><h2>Blocked</h2></div><Card><div className="list">{res.data.blocked.map((p) => <PersonRow key={p.id} p={{ ...p, relation: 'blocked_by_me' }} a={a} />)}</div></Card></>}
      </div>
    );
  }
  return (
    <div className="stack">
      {incoming.length === 0 && outgoing.length === 0 && <Card><Empty title="No pending requests" icon={<UserPlusIcon />}>When someone wants to connect with you, it shows up here.</Empty></Card>}
      {incoming.length > 0 && <><div className="section-title"><h2>Wants to connect with you</h2></div><Card><div className="list">{incoming.map((c) => <div key={c.id}><PersonRow p={{ ...c.user, relation: 'incoming', connectionId: c.id }} a={a} />{c.note && <p className="note">“{c.note}”</p>}</div>)}</div></Card></>}
      {outgoing.length > 0 && <><div className="section-title"><h2>Sent by you</h2></div><Card><div className="list">{outgoing.map((c) => <PersonRow key={c.id} p={{ ...c.user, relation: 'outgoing', connectionId: c.id }} a={a} />)}</div></Card></>}
    </div>
  );
}

function Profile() {
  const { id } = useParams();
  const res = useGet<{ profile: PublicProfile }>(id ? `/people/${id}` : null);
  const a = useRelationActions(res.reload);
  const [blockAsk, setBlockAsk] = useState(false);
  if (res.loading && !res.data) return <Loading />;
  if (res.error || !res.data) return <ErrorNote onRetry={res.reload}>{res.error ?? 'Not found.'}</ErrorNote>;
  const p = res.data.profile;
  return (
    <>
      <PageHeader back={<Link to="/app/people" className="back"><BackIcon /> People</Link>} title={p.displayName} sub={subline(p)} />
      <div className="two-col">
        <Card className="stack">
          <div className="row"><Avatar name={p.displayName} size={72} /><div><RoleTag role={p.role} />{p.role === 'student' && <Badge>Student</Badge>}</div></div>
          {p.bio ? <p className="pre">{p.bio}</p> : <p className="muted">No bio yet.</p>}
          <RelationButtons p={p} relation={p.relation} connectionId={p.connectionId} a={a} large />
          {p.relation !== 'blocked_by_me' && p.relation !== 'blocked' && <div><Button size="sm" kind="quiet" onClick={() => setBlockAsk(true)}><BanIcon /> Block</Button></div>}
        </Card>
        <Card className="stack">
          <h3>Details</h3>
          <dl className="facts">
            {p.role === 'lecturer' ? <>
              {p.department && <><dt>Department</dt><dd>{p.department}</dd></>}
              {p.office && <><dt><PinIcon /> Office</dt><dd>{p.office}</dd></>}
              {p.officeHours && <><dt>Office hours</dt><dd>{p.officeHours}</dd></>}
            </> : <>
              {p.courseName && <><dt>Course</dt><dd>{p.courseName}</dd></>}
              {p.yearOfStudy && <><dt>Year</dt><dd>{p.yearOfStudy}</dd></>}
            </>}
            {p.email && <><dt><MailIcon /> Email</dt><dd><a href={`mailto:${p.email}`}>{p.email}</a></dd></>}
            <dt>Member since</dt><dd>{fullDate(p.memberSince)}</dd>
          </dl>
          {p.sharedClasses.length > 0 && <><h4>Classes you share</h4><div className="row wrap">{p.sharedClasses.map((c) => <span key={c.offeringId} className="code-chip" title={c.unitName}>{c.unitCode}</span>)}</div></>}
        </Card>
      </div>
      <Confirm open={blockAsk} title={`Block ${p.displayName}?`} danger confirmLabel="Block" onConfirm={() => { a.block(p.id); setBlockAsk(false); }} onClose={() => setBlockAsk(false)}>
        They will not be able to message you or send requests. You can unblock them any time from your connections.
      </Confirm>
    </>
  );
}

function Hub() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'discover' | 'requests' | 'friends') || 'discover';
  const counts = useGet<{ connections: ConnectionItem[] }>('/connections');
  const incoming = counts.data?.connections.filter((c) => c.status === 'pending' && c.direction === 'incoming').length ?? 0;
  return (
    <>
      <PageHeader title="People" sub="Find classmates and lecturers. Send a request to connect with a student; lecturers can be messaged directly." />
      <Tabs value={tab} onChange={(t) => setParams(t === 'discover' ? {} : { tab: t })} tabs={[{ id: 'discover', label: 'Discover' }, { id: 'requests', label: 'Requests', badge: incoming || undefined }, { id: 'friends', label: 'Connections' }]} />
      <div className="tab-panel">{tab === 'discover' ? <Discover /> : <Requests mode={tab} />}</div>
    </>
  );
}

export default function People() {
  return <Routes><Route index element={<Hub />} /><Route path=":id" element={<Profile />} /></Routes>;
}
