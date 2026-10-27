import { io, type Socket } from 'socket.io-client';
import { ApiError, type ApiClient } from './api';
import type { ClusterMonitor } from './cluster';
import type { AppNotification, LinkState, Reaction, SendAck, WireMessage } from './types';

interface Events {
  state: { link: LinkState; node: string | null };
  message: WireMessage;
  deleted: { conversationId: string; messageId: string };
  reactions: { conversationId: string; messageId: string; reactions: Reaction[] };
  notify: AppNotification;
  /** Handshake finished. `reconnect` is false for the very first connection of this session. */
  online: { node: string; reconnect: boolean };
  /** The server asked clients to re-sync (Redis came back after an outage). */
  sync: undefined;
  /** The session cannot be renewed any more; the user has to sign in again. */
  authLost: undefined;
}

type Listener<T> = (payload: T) => void;

class Emitter<E extends object> {
  private readonly listeners = new Map<keyof E, Set<Listener<never>>>();

  on<K extends keyof E>(event: K, listener: Listener<E[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => {
      set?.delete(listener as Listener<never>);
    };
  }

  protected emit<K extends keyof E>(event: K, payload: E[K]): void {
    for (const listener of this.listeners.get(event) ?? []) (listener as Listener<E[K]>)(payload);
  }
}

const jitter = (ms: number): number => ms * (0.7 + Math.random() * 0.6);

/**
 * Owns the single WebSocket connection.
 *
 * Socket.IO's built-in reconnection always retries the same URL. We need to
 * retry a *different* node, so reconnection is off and this class runs its own
 * loop: pick the best node, connect, and on any failure pick again. The first
 * retry after a drop is immediate, so a crashed node costs the user about a
 * fraction of a second rather than a visible outage.
 */
export class RealtimeClient extends Emitter<Events> {
  link: LinkState = 'offline';
  node: string | null = null;

  private socket: Socket | null = null;
  private running = false;
  private attempt = 0;
  private everConnected = false;
  private lastFailedNode: string | undefined;
  private timer: number | undefined;

  constructor(
    private readonly monitor: ClusterMonitor,
    private readonly api: ApiClient,
  ) {
    super();
    // Hand every refreshed access token to the live socket so the server keeps it open.
    api.onToken((token) => {
      if (token && this.socket?.connected) this.socket.emit('auth:renew', { token });
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    this.lastFailedNode = undefined;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    window.clearTimeout(this.timer);
    this.teardown();
    this.everConnected = false;
    this.setLink('offline', null);
  }

  /**
   * Sends a message and waits for the server's acknowledgement.
   * Rejects when there is no live connection or the ack does not arrive in time;
   * the caller may then safely retry with the same clientMessageId.
   */
  async send(payload: { conversationId: string; clientMessageId: string; body: string; replyToId?: string }): Promise<SendAck> {
    const socket = this.socket;
    if (!socket || !socket.connected || this.link !== 'online') throw new Error('offline');
    try {
      return (await socket.timeout(6_000).emitWithAck('message:send', payload)) as SendAck;
    } catch {
      throw new Error('timeout');
    }
  }

  // ------------------------------------------------------------------ internals

  private setLink(link: LinkState, node: string | null): void {
    this.link = link;
    this.node = node;
    this.emit('state', { link, node });
  }

  private teardown(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    this.setLink(this.everConnected ? 'reconnecting' : 'connecting', null);

    let token: string;
    try {
      token = await this.api.ensureToken();
    } catch (err) {
      if (err instanceof ApiError && err.isAuth) return this.loseAuth();
      return this.scheduleRetry();
    }
    if (!this.running) return;

    const [target] = this.monitor.candidates({ avoid: this.lastFailedNode });
    if (!target) return this.scheduleRetry();

    this.teardown();
    const socket = io(target.url, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      forceNew: true,
      timeout: 5_000,
    });
    this.socket = socket;

    socket.on('node:hello', (hello: { node: string }) => {
      if (this.socket !== socket) return;
      const reconnect = this.everConnected;
      this.everConnected = true;
      this.attempt = 0;
      this.lastFailedNode = undefined;
      this.monitor.reportSuccess(target.id);
      this.setLink('online', hello.node);
      this.emit('online', { node: hello.node, reconnect });
    });
    socket.on('message:new', (message: WireMessage) => this.emit('message', message));
    socket.on('message:deleted', (e: Events['deleted']) => this.emit('deleted', e));
    socket.on('message:reactions', (e: Events['reactions']) => this.emit('reactions', e));
    socket.on('notify:new', (n: AppNotification) => this.emit('notify', n));
    socket.on('sync:required', () => this.emit('sync', undefined));
    socket.on('connect_error', (err: Error) => {
      // The server attaches a machine-readable reason (NO_TOKEN, TOKEN_EXPIRED, RATE_LIMITED...) as err.data.code.
      const code = (err as Error & { data?: { code?: string } }).data?.code;
      if (this.socket === socket) void this.onFailure(target.id, code);
    });
    socket.on('disconnect', (reason: string) => {
      if (this.socket !== socket) return;
      // "io server disconnect" is the server closing us on purpose (token expiry); the node itself is fine.
      void this.onFailure(target.id, reason === 'io server disconnect' ? 'SERVER_CLOSED' : undefined);
    });
  }

  private async onFailure(nodeId: string, code: string | undefined): Promise<void> {
    this.teardown();
    if (!this.running) return;

    if (code === 'ACCOUNT_INACTIVE' || code === 'PASSWORD_CHANGE_REQUIRED') return this.loseAuth();

    if (code === 'TOKEN_EXPIRED' || code === 'INVALID_TOKEN' || code === 'NO_TOKEN' || code === 'SERVER_CLOSED') {
      try {
        await this.api.refresh();
      } catch (err) {
        if (err instanceof ApiError && err.isAuth) return this.loseAuth();
      }
      this.attempt = 0;
      return this.scheduleRetry();
    }

    if (code !== 'RATE_LIMITED') this.monitor.reportFailure(nodeId);
    this.lastFailedNode = nodeId;
    this.scheduleRetry(code === 'RATE_LIMITED' ? 5_000 : undefined);
  }

  private scheduleRetry(minDelayMs = 0): void {
    if (!this.running) return;
    // Show "offline" only after a few failures in a row; a quick hop between nodes is not an outage.
    this.setLink(this.attempt >= 3 ? 'offline' : this.everConnected ? 'reconnecting' : 'connecting', null);
    const base = this.attempt === 0 ? 150 : Math.min(500 * 2 ** (this.attempt - 1), 5_000);
    this.attempt += 1;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.connect(), Math.max(minDelayMs, jitter(base)));
  }

  private loseAuth(): void {
    this.running = false;
    this.teardown();
    this.setLink('offline', null);
    this.emit('authLost', undefined);
  }
}
