import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar, RoleTag } from '../../components/bits';
import { Composer } from '../../components/Composer';
import { BackIcon, ChatIcon, PlusIcon, SearchIcon, UsersIcon } from '../../components/icons';
import { MessageList } from '../../components/MessageList';
import { Badge, Button, Confirm, CopyText, ErrorNote, Loading, Modal, Notice, Segmented, TextArea, TextField } from '../../components/ui';
import { cx, listTime } from '../../lib/format';
import type { ChatMessage, ConversationSummary, Member } from '../../lib/types';
import { errorText, fieldErrors, useGet } from '../../lib/useApi';
import { useChat } from '../../state/chat';
import { useSession } from '../../state/session';
import { useToast } from '../../state/toast';

type Filter = 'all' | 'direct' | 'class' | 'group';

function ConvRow({ c, on, unread }: { c: ConversationSummary; on: boolean; unread: number }) {
  return (
    <Link to={`/app/messages/${c.id}`} className={cx('conv', on && 'on')}>
      <Avatar name={c.name} size={40} square={c.kind !== 'direct'} />
      <span className="conv-main">
        <b>{c.name}</b>
        <span>{c.lastMessage ? `${c.kind === 'direct' ? '' : `${c.lastMessage.senderName.split(' ')[0]}: `}${c.lastMessage.body}` : c.kind === 'class' ? 'Class chat' : c.kind === 'group' ? c.description || 'Group' : 'Say hello'}</span>
      </span>
      <span className="conv-meta">{c.lastMessage && <span>{listTime(c.lastMessage.createdAt)}</span>}{unread > 0 && <span className="unread-dot" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}</span>
    </Link>
  );
}

function GroupDialog({ open, onClose, canCreate }: { open: boolean; onClose(): void; canCreate: boolean }) {
  const chat = useChat();
  const nav = useNavigate();
  const [mode, setMode] = useState<'join' | 'create'>(canCreate ? 'create' : 'join');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrs({}); setMsg(null);
    try {
      if (mode === 'create') await chat.createGroup(name, desc); else await chat.joinGroup(code);
      onClose(); setName(''); setDesc(''); setCode('');
    } catch (err) { setErrs(fieldErrors(err)); setMsg(errorText(err)); } finally { setBusy(false); }
  };
  void nav;
  return (
    <Modal open={open} onClose={onClose} title={mode === 'create' ? 'Start a group' : 'Join with a code'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button kind="primary" type="submit" form="group-form" busy={busy} disabled={mode === 'create' ? name.trim().length < 2 : code.trim().length < 11}>{mode === 'create' ? 'Create group' : 'Join'}</Button></>}>
      <form id="group-form" onSubmit={submit} className="stack">
        {canCreate && <Segmented<'join' | 'create'> label="Group action" value={mode} options={[{ value: 'create', label: 'Create' }, { value: 'join', label: 'Join with code' }]} onChange={setMode} />}
        {mode === 'create' ? (
          <>
            <TextField label="Group name" value={name} onChange={(e) => setName(e.target.value)} error={errs.name} maxLength={80} autoFocus />
            <TextArea label="What is it for?" optional rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} />
          </>
        ) : <TextField label="Invite code" placeholder="ABCDE-12345" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} error={errs.inviteCode} autoFocus />}
        {msg && !Object.keys(errs).length && <Notice tone="warn">{msg}</Notice>}
      </form>
    </Modal>
  );
}

function MembersDialog({ c, onClose }: { c: ConversationSummary; onClose(): void }) {
  const res = useGet<{ members: Member[] }>(`/conversations/${c.id}/members`);
  return (
    <Modal open onClose={onClose} title={`${c.name} · ${c.memberCount} member${c.memberCount === 1 ? '' : 's'}`} footer={<Button kind="primary" onClick={onClose}>Done</Button>}>
      {c.inviteCode && c.kind === 'group' && <div className="invite"><small className="muted">Invite code</small><CopyText text={c.inviteCode} label="Copy code" /><code>{c.inviteCode}</code></div>}
      {res.loading ? <Loading /> : res.error ? <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote> : (
        <div className="list">{res.data!.members.map((m) => (
          <Link key={m.id} to={`/app/people/${m.id}`} className="list-item" onClick={onClose}>
            <Avatar name={m.displayName} size={34} /><span className="list-main"><b>{m.displayName}</b></span><RoleTag role={m.role} title={m.title} />{m.memberRole === 'owner' && <Badge tone="accent">Owner</Badge>}
          </Link>
        ))}</div>
      )}
    </Modal>
  );
}

export default function Messages() {
  const chat = useChat();
  const { user, prefs } = useSession();
  const { id } = useParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState(false);
  const [members, setMembers] = useState(false);
  const toast = useToast();
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [toDelete, setToDelete] = useState<ChatMessage | null>(null);
  const [deleting, setDeleting] = useState(false);

  // A reply belongs to one conversation, so switching conversations drops it.
  useEffect(() => setReplyTo(null), [id]);

  const react = (m: ChatMessage, emoji: string) => chat.react(m, emoji).catch((e) => toast.show(errorText(e), 'bad'));
  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await chat.deleteMessage(toDelete);
      if (replyTo?.id === toDelete.id) setReplyTo(null);
      setToDelete(null);
    } catch (e) { toast.show(errorText(e), 'bad'); } finally { setDeleting(false); }
  };

  useEffect(() => { chat.select(id ?? null); return () => chat.select(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const list = useMemo(() => chat.conversations.filter((c) => (filter === 'all' || c.kind === filter) && (!q || c.name.toLowerCase().includes(q.toLowerCase()))), [chat.conversations, filter, q]);
  const active = chat.active;
  const showNode = user!.role === 'admin' || !!prefs.showServerDetails;

  return (
    <div className={cx('msgs', active && 'has-active')}>
      <aside className="msgs-list" aria-label="Conversations">
        <div className="msgs-list-head">
          <div className="row"><h1>Messages</h1><span className="spacer" /><Button size="sm" onClick={() => setDialog(true)}><PlusIcon /> Group</Button></div>
          <label className="search"><SearchIcon /><input placeholder="Search conversations" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations" /></label>
          <Segmented<Filter> label="Filter" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'direct', label: 'Private' }, { value: 'class', label: 'Classes' }, { value: 'group', label: 'Groups' }]} />
        </div>
        <div className="conv-scroll">
          {chat.listState === 'loading' ? <Loading /> : chat.listState === 'error' ? <ErrorNote onRetry={chat.reloadList}>Could not load your conversations.</ErrorNote> : list.length === 0 ? (
            <div className="empty small"><p>{chat.conversations.length === 0 ? 'No conversations yet.' : 'Nothing matches.'}</p>
              {chat.conversations.length === 0 && <p className="muted">Find classmates and lecturers in <Link to="/app/people">People</Link> to start a private chat, or join your class group.</p>}</div>
          ) : list.map((c) => <ConvRow key={c.id} c={c} on={c.id === chat.activeId} unread={chat.unread[c.id] ?? 0} />)}
        </div>
      </aside>

      <section className="thread" aria-label="Conversation">
        {!active ? (
          <div className="thread-empty"><div><ChatIcon width={40} height={40} /><h2>Pick a conversation</h2><p>Your private chats, class groups and study groups live here.</p></div></div>
        ) : (
          <>
            <header className="thread-head">
              <Link to="/app/messages" className="btn icon back-mobile" aria-label="Back to conversations"><BackIcon /></Link>
              <Avatar name={active.name} size={38} square={active.kind !== 'direct'} />
              <div className="grow">
                <h2>{active.name}</h2>
                <small>{active.kind === 'direct' && active.peer ? <>{active.peer.role === 'lecturer' ? `${active.peer.title ?? 'Lecturer'}` : 'Student'} · <Link to={`/app/people/${active.peer.id}`}>View profile</Link></> : `${active.memberCount} member${active.memberCount === 1 ? '' : 's'}${active.kind === 'class' ? ' · class chat' : ''}`}</small>
              </div>
              {active.kind !== 'direct' && <Button size="sm" onClick={() => setMembers(true)}><UsersIcon /> Members</Button>}
            </header>
            <MessageList messages={chat.conv.messages} meId={user!.id} loading={chat.conv.loading && !chat.conv.loaded} loadingOlder={chat.conv.loadingOlder} hasMore={chat.conv.hasMore} error={chat.conv.error}
              link={chat.link.state} showNode={showNode} onLoadOlder={chat.loadOlder} onRetryLoad={chat.reloadActive} onRetrySend={chat.retrySend}
              onReply={setReplyTo} onDelete={setToDelete} onReact={react}
              canModerate={user!.role === 'admin' || (active.kind !== 'direct' && active.myRole === 'owner')} />
            <Composer groupName={active.name} link={chat.link.state} replyTo={replyTo} onCancelReply={() => setReplyTo(null)}
              onSend={(body) => { chat.send(body, replyTo); setReplyTo(null); }} />
          </>
        )}
      </section>
      <GroupDialog open={dialog} onClose={() => setDialog(false)} canCreate />
      <Confirm open={!!toDelete} danger title="Delete this message?" confirmLabel="Delete for everyone" busy={deleting} onConfirm={confirmDelete} onClose={() => setToDelete(null)}>
        The text is erased for everyone in this conversation. This cannot be undone.
      </Confirm>
      {members && active && <MembersDialog c={active} onClose={() => setMembers(false)} />}
    </div>
  );
}
