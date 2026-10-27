import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from '../lib/api';
import { uuid } from '../lib/ids';
import { api, realtime } from '../lib/singletons';
import type { ChatMessage, ConversationSummary, LinkState, Reaction, WireMessage } from '../lib/types';
import { useSession } from './session';

interface ConvState {
  messages: ChatMessage[];
  loaded: boolean;
  loading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  error: string | null;
}

const EMPTY: ConvState = { messages: [], loaded: false, loading: false, loadingOlder: false, hasMore: false, error: null };

interface ChatValue {
  conversations: ConversationSummary[];
  listState: 'loading' | 'ready' | 'error';
  activeId: string | null;
  active: ConversationSummary | null;
  conv: ConvState;
  unread: Record<string, number>;
  link: { state: LinkState; node: string | null };
  select(id: string | null): void;
  send(body: string, replyTo?: ChatMessage | null): void;
  /** Deletes a message for everyone in the conversation. */
  deleteMessage(m: ChatMessage): Promise<void>;
  /** Adds or removes your reaction. */
  react(m: ChatMessage, emoji: string): Promise<void>;
  retrySend(clientMessageId: string): void;
  loadOlder(): void;
  reloadActive(): void;
  reloadList(): void;
  createGroup(name: string, description: string): Promise<void>;
  joinGroup(code: string): Promise<void>;
  /** Opens (or creates) the private chat with someone and returns its id. */
  openDirect(userId: string): Promise<string>;
  /** Opens or creates the chat for a class and returns its id. */
  openClassChat(offeringId: string): Promise<string>;
  totalUnread: number;
}

const Ctx = createContext<ChatValue | null>(null);

export function useChat(): ChatValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useChat must be used inside <ChatProvider>');
  return value;
}

const toChat = (m: WireMessage): ChatMessage => ({
  id: m.id,
  seq: m.seq,
  conversationId: m.conversationId,
  clientMessageId: m.clientMessageId,
  body: m.body,
  createdAt: m.createdAt,
  originNode: m.originNode,
  senderId: m.sender.id,
  senderName: m.sender.displayName,
  senderRole: m.sender.role,
  status: 'sent',
  attempts: 0,
  replyTo: m.replyTo ?? null,
  deleted: m.deleted ?? false,
  reactions: m.reactions ?? [],
});

/** Saved messages by seq, then unsent ones (in the order they were typed) at the bottom. */
const compare = (a: ChatMessage, b: ChatMessage): number => {
  if (a.seq !== null && b.seq !== null) return a.seq - b.seq;
  if (a.seq !== null) return -1;
  if (b.seq !== null) return 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
};

/** Merge by clientMessageId so a pending message is replaced, never duplicated, when its saved copy arrives. */
function merge(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of existing) byId.set(m.clientMessageId, m);
  for (const m of incoming) {
    const prev = byId.get(m.clientMessageId);
    if (!prev || prev.status !== 'sent' || m.status === 'sent') byId.set(m.clientMessageId, m);
  }
  return [...byId.values()].sort(compare);
}

const byRecency = (a: ConversationSummary, b: ConversationSummary): number =>
  (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.createdAt);

/** Ack codes where trying again later can succeed. Anything else is shown to the user as a failure. */
const RETRYABLE = new Set(['SAVE_FAILED', 'TOKEN_EXPIRED']);
const MAX_AUTO_ATTEMPTS = 4;

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const me = user!;

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [byConv, setByConv] = useState<Record<string, ConvState>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [link, setLink] = useState<{ state: LinkState; node: string | null }>({
    state: realtime.link,
    node: realtime.node,
  });

  // Refs give long-lived callbacks (socket events, timers) the latest state without re-subscribing.
  const byConvRef = useRef(byConv);
  byConvRef.current = byConv;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const inFlight = useRef(new Set<string>());

  const patchConv = useCallback((id: string, fn: (c: ConvState) => ConvState) => {
    setByConv((all) => ({ ...all, [id]: fn(all[id] ?? EMPTY) }));
  }, []);

  const touchList = useCallback((m: ChatMessage) => {
    setConversations((list) =>
      list
        .map((c) =>
          c.id === m.conversationId
            ? {
                ...c,
                lastMessage: {
                  id: m.id,
                  seq: m.seq ?? c.lastMessage?.seq ?? 0,
                  body: m.body.slice(0, 140),
                  createdAt: m.createdAt,
                  senderName: m.senderName,
                },
              }
            : c,
        )
        .sort(byRecency),
    );
  }, []);

  // ---------------------------------------------------------------- loading

  const reloadList = useCallback(() => {
    api.listConversations().then(
      ({ conversations: list }) => {
        setConversations([...list].sort(byRecency));
        setListState('ready');
      },
      () => setListState((s) => (s === 'ready' ? s : 'error')),
    );
  }, []);

  const loadLatest = useCallback(
    (id: string) => {
      patchConv(id, (c) => ({ ...c, loading: true, error: null }));
      api.history(id, { limit: 50 }).then(
        (page) =>
          patchConv(id, (c) => ({
            ...c,
            loaded: true,
            loading: false,
            hasMore: page.hasMore,
            messages: merge(c.messages, page.messages.map(toChat)),
          })),
        (err: unknown) =>
          patchConv(id, (c) => ({
            ...c,
            loading: false,
            error: err instanceof ApiError ? err.message : 'Could not load messages.',
          })),
      );
    },
    [patchConv],
  );

  const loadOlder = useCallback(() => {
    const id = activeRef.current;
    if (!id) return;
    const c = byConvRef.current[id];
    if (!c || c.loadingOlder || !c.hasMore) return;
    const oldest = c.messages.find((m) => m.seq !== null)?.seq;
    if (oldest === undefined || oldest === null) return;
    patchConv(id, (x) => ({ ...x, loadingOlder: true }));
    api.history(id, { before: oldest, limit: 50 }).then(
      (page) =>
        patchConv(id, (x) => ({
          ...x,
          loadingOlder: false,
          hasMore: page.hasMore,
          messages: merge(x.messages, page.messages.map(toChat)),
        })),
      () => patchConv(id, (x) => ({ ...x, loadingOlder: false })),
    );
  }, [patchConv]);

  /** After any reconnect: pull everything newer than what we already hold, in every opened conversation. */
  const catchUp = useCallback(async () => {
    const entries = Object.entries(byConvRef.current).filter(([, c]) => c.loaded);
    await Promise.all(
      entries.map(async ([id, c]) => {
        // Reactions and deletions that happened while we were away do not move the "after" cursor, so refresh the newest page too.
        try {
          const latest = await api.history(id, { limit: 50 });
          patchConv(id, (x) => ({ ...x, messages: merge(x.messages, latest.messages.map(toChat)) }));
        } catch {
          /* the paging below will try again */
        }
        let after = c.messages.reduce((max, m) => (m.seq !== null && m.seq > max ? m.seq : max), 0);
        for (let page = 0; page < 20; page++) {
          try {
            const res = await api.history(id, { after, limit: 100 });
            if (res.messages.length === 0) break;
            patchConv(id, (x) => ({ ...x, messages: merge(x.messages, res.messages.map(toChat)) }));
            after = res.messages[res.messages.length - 1].seq;
            if (!res.hasMore) break;
          } catch {
            break; // The next reconnect or sync will try again.
          }
        }
      }),
    );
  }, [patchConv]);

  // ---------------------------------------------------------------- sending

  const transmit = useCallback(
    async (msg: ChatMessage) => {
      const key = msg.clientMessageId;
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      const patch = (fields: Partial<ChatMessage>) =>
        patchConv(msg.conversationId, (c) => ({
          ...c,
          messages: c.messages.map((m) => (m.clientMessageId === key && m.status !== 'sent' ? { ...m, ...fields } : m)),
        }));
      try {
        const ack = await realtime.send({
          conversationId: msg.conversationId,
          clientMessageId: key,
          body: msg.body,
          ...(msg.replyTo ? { replyToId: msg.replyTo.id } : {}),
        });
        if (ack.ok) {
          const saved = toChat(ack.message);
          patchConv(msg.conversationId, (c) => ({ ...c, messages: merge(c.messages, [saved]) }));
          touchList(saved);
        } else if (RETRYABLE.has(ack.code) && msg.attempts + 1 < MAX_AUTO_ATTEMPTS) {
          patch({ status: 'sending', attempts: msg.attempts + 1 });
        } else {
          patch({ status: 'failed', error: ack.message });
        }
      } catch {
        // No connection, or no answer in time. The message may or may not have been
        // saved; resending with the same clientMessageId is safe either way.
        patch({ status: 'sending' });
      } finally {
        inFlight.current.delete(key);
      }
    },
    [patchConv, touchList],
  );

  const flushPending = useCallback(() => {
    if (realtime.link !== 'online') return;
    for (const c of Object.values(byConvRef.current)) {
      for (const m of c.messages) if (m.status === 'sending') void transmit(m);
    }
  }, [transmit]);

  const send = useCallback(
    (body: string, replyTo?: ChatMessage | null) => {
      const id = activeRef.current;
      const text = body.trim();
      if (!id || !text) return;
      const clientMessageId = uuid();
      const msg: ChatMessage = {
        id: clientMessageId,
        seq: null,
        conversationId: id,
        clientMessageId,
        body: text,
        createdAt: new Date().toISOString(),
        originNode: null,
        senderId: me.id,
        senderName: me.displayName,
        senderRole: me.role,
        status: 'sending',
        attempts: 0,
        replyTo: replyTo && !replyTo.deleted ? { id: replyTo.id, senderId: replyTo.senderId, senderName: replyTo.senderName, body: replyTo.body.slice(0, 160), deleted: false } : null,
        deleted: false,
        reactions: [],
      };
      patchConv(id, (c) => ({ ...c, messages: merge(c.messages, [msg]) }));
      void transmit(msg);
    },
    [me.id, me.displayName, patchConv, transmit],
  );

  const retrySend = useCallback(
    (clientMessageId: string) => {
      for (const c of Object.values(byConvRef.current)) {
        const m = c.messages.find((x) => x.clientMessageId === clientMessageId);
        if (m) {
          const fresh: ChatMessage = { ...m, status: 'sending', attempts: 0, error: undefined };
          patchConv(m.conversationId, (x) => ({
            ...x,
            messages: x.messages.map((y) => (y.clientMessageId === clientMessageId ? fresh : y)),
          }));
          void transmit(fresh);
          return;
        }
      }
    },
    [patchConv, transmit],
  );

  // ---------------------------------------------------------------- reply, delete, react

  const patchMessage = useCallback(
    (conversationId: string, messageId: string, fn: (m: ChatMessage) => ChatMessage) =>
      patchConv(conversationId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === messageId ? fn(m) : m)) })),
    [patchConv],
  );

  const deleteMessage = useCallback(
    async (m: ChatMessage) => {
      await api.del(`/conversations/${m.conversationId}/messages/${m.id}`);
      patchMessage(m.conversationId, m.id, (x) => ({ ...x, body: '', deleted: true, reactions: [], replyTo: null }));
    },
    [patchMessage],
  );

  const react = useCallback(
    async (m: ChatMessage, emoji: string) => {
      const res = await api.post<{ reactions: Reaction[] }>(`/conversations/${m.conversationId}/messages/${m.id}/reactions`, { emoji });
      patchMessage(m.conversationId, m.id, (x) => ({ ...x, reactions: res.reactions }));
    },
    [patchMessage],
  );

  // ---------------------------------------------------------------- groups

  const select = useCallback((id: string | null) => {
    setActiveId(id);
    if (id) setUnread((u) => (u[id] ? { ...u, [id]: 0 } : u));
  }, []);

  const createGroup = useCallback(
    async (name: string, description: string) => {
      const { conversation } = await api.createConversation(name, description);
      setConversations((list) => [conversation, ...list.filter((c) => c.id !== conversation.id)]);
      select(conversation.id);
    },
    [select],
  );

  const joinGroup = useCallback(
    async (code: string) => {
      const { conversation } = await api.joinConversation(code);
      setConversations((list) => [conversation, ...list.filter((c) => c.id !== conversation.id)].sort(byRecency));
      select(conversation.id);
    },
    [select],
  );

  const adopt = useCallback((conversation: ConversationSummary) => {
    setConversations((list) => [conversation, ...list.filter((c) => c.id !== conversation.id)].sort(byRecency));
    return conversation.id;
  }, []);

  const openDirect = useCallback(async (userId: string) => adopt((await api.openDirect(userId)).conversation), [adopt]);
  const openClassChat = useCallback(
    async (offeringId: string) => adopt((await api.post<{ conversation: ConversationSummary }>(`/classes/${offeringId}/chat`)).conversation),
    [adopt],
  );

  const reloadActive = useCallback(() => {
    if (activeRef.current) loadLatest(activeRef.current);
  }, [loadLatest]);

  // ---------------------------------------------------------------- wiring

  useEffect(() => {
    reloadList();
    realtime.start();
    const offState = realtime.on('state', (s) => setLink({ state: s.link, node: s.node }));
    const offMessage = realtime.on('message', (wire) => {
      const m = toChat(wire);
      patchConv(m.conversationId, (c) => ({ ...c, messages: merge(c.messages, [m]) }));
      touchList(m);
      if (m.senderId !== me.id && m.conversationId !== activeRef.current) {
        setUnread((u) => ({ ...u, [m.conversationId]: (u[m.conversationId] ?? 0) + 1 }));
      }
    });
    // A message keeps its place in the list: only its text, reactions and replies change.
    const offDeleted = realtime.on('deleted', (e) =>
      patchMessage(e.conversationId, e.messageId, (x) => ({ ...x, body: '', deleted: true, reactions: [], replyTo: null })),
    );
    const offReactions = realtime.on('reactions', (e) => patchMessage(e.conversationId, e.messageId, (x) => ({ ...x, reactions: e.reactions })));
    const resync = () => {
      reloadList();
      void catchUp().then(flushPending);
    };
    const offOnline = realtime.on('online', resync);
    const offSync = realtime.on('sync', resync);
    return () => {
      offState();
      offMessage();
      offDeleted();
      offReactions();
      offOnline();
      offSync();
      realtime.stop();
    };
  }, [me.id, patchConv, patchMessage, touchList, reloadList, catchUp, flushPending]);

  // Open a conversation: load its latest messages the first time.
  useEffect(() => {
    if (!activeId) return;
    const c = byConvRef.current[activeId];
    if (!c?.loaded && !c?.loading) loadLatest(activeId);
  }, [activeId, loadLatest]);

  // Safety net: anything still waiting gets another go every few seconds while connected.
  useEffect(() => {
    const timer = window.setInterval(flushPending, 4_000);
    return () => window.clearInterval(timer);
  }, [flushPending]);

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) Elimu` : 'Elimu';
  }, [totalUnread]);

  const value = useMemo<ChatValue>(
    () => ({
      conversations,
      listState,
      activeId,
      active: conversations.find((c) => c.id === activeId) ?? null,
      conv: (activeId && byConv[activeId]) || EMPTY,
      unread,
      link,
      select,
      send,
      deleteMessage,
      react,
      retrySend,
      loadOlder,
      reloadActive,
      reloadList,
      createGroup,
      joinGroup,
      openDirect,
      openClassChat,
      totalUnread,
    }),
    [
      conversations,
      listState,
      activeId,
      byConv,
      unread,
      link,
      select,
      send,
      deleteMessage,
      react,
      retrySend,
      loadOlder,
      reloadActive,
      reloadList,
      createGroup,
      joinGroup,
      openDirect,
      openClassChat,
      totalUnread,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
