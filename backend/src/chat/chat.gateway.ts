import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { TokenService } from '../auth/token.service';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import { MAX_MESSAGE_LENGTH, sendMessageSchema } from '../messages/messages.dto';
import { MessagesService, WireMessage } from '../messages/messages.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { RealtimeBus } from '../realtime/realtime.bus';
import { UsersRepository } from '../users/users.repository';

interface SocketUser {
  id: string;
  displayName: string;
  role: string;
  /** Access-token expiry, in seconds since the epoch. */
  exp: number;
}

type SendAck =
  | { ok: true; message: WireMessage; duplicate: boolean; delivery: 'cluster' | 'local'; node: string }
  | { ok: false; code: string; message: string; retryAfterSec?: number };

const renewSchema = z.object({ token: z.string().min(10).max(2100) }).strict();

const fail = (code: string, message: string, retryAfterSec?: number): SendAck => ({
  ok: false,
  code,
  message,
  ...(retryAfterSec ? { retryAfterSec } : {}),
});

/** Connection errors carry a machine-readable code the client can act on. */
const handshakeError = (code: string, message = 'unauthorized'): Error => {
  const err = new Error(message) as Error & { data?: { code: string } };
  err.data = { code };
  return err;
};

@WebSocketGateway()
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger('Chat');
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly tokens: TokenService,
    private readonly users: UsersRepository,
    private readonly db: DatabaseService,
    private readonly messages: MessagesService,
    private readonly limiter: RateLimitService,
    private readonly bus: RealtimeBus,
  ) {}

  afterInit(server: Server): void {
    this.bus.attachServer(server);
    // Runs before the connection is established; rejecting here means the
    // client never becomes a connected socket at all.
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (err: Error) => next(err),
      );
    });
  }

  handleConnection(socket: Socket): void {
    const user = this.userOf(socket);
    if (!user) return;
    this.scheduleExpiry(socket, user);
    socket.emit('node:hello', { node: this.cfg.NODE_ID, serverTime: new Date().toISOString() });
    this.log.debug(`${this.cfg.NODE_ID}: ${user.id} connected (${this.bus.connectionCount()} total)`);
  }

  handleDisconnect(socket: Socket): void {
    const timer = this.expiryTimers.get(socket.id);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(socket.id);
  }

  @SubscribeMessage('message:send')
  async onSend(@ConnectedSocket() socket: Socket, @MessageBody() raw: unknown): Promise<SendAck> {
    const user = this.userOf(socket);
    if (!user || user.exp * 1000 <= Date.now()) {
      return fail('TOKEN_EXPIRED', 'Your session expired. Reconnecting…');
    }

    const parsed = sendMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', `Messages must be 1 to ${MAX_MESSAGE_LENGTH} characters.`);
    }
    const input = parsed.data;

    // Shared across all nodes through Redis: 20 messages per 10 seconds per user.
    const limit = await this.limiter.consume('ws-message', user.id, 20, 10);
    if (!limit.allowed) {
      return fail('RATE_LIMITED', 'You are sending messages too quickly.', limit.retryAfterSec);
    }

    try {
      // 1) save  2) broadcast  3) acknowledge. The ack is only sent after the row exists.
      const { message, duplicate } = await this.messages.save({
        ...input,
        originNode: this.cfg.NODE_ID,
        sender: { id: user.id, displayName: user.displayName, role: user.role },
      });
      // A duplicate is re-broadcast on purpose: if the first attempt saved the row
      // but this node died before pushing it, the retry repairs delivery. Clients
      // ignore message ids they already have.
      const delivery = this.bus.emitToConversation(message.conversationId, 'message:new', message);
      return { ok: true, message, duplicate, delivery, node: this.cfg.NODE_ID };
    } catch (err) {
      const status = (err as { getStatus?: () => number }).getStatus?.();
      const body = (err as { getResponse?: () => { code?: string; message?: string } }).getResponse?.();
      if (status && status < 500) {
        return fail(body?.code ?? 'REJECTED', body?.message ?? 'Message was rejected.');
      }
      this.log.error(`Failed to save message: ${(err as Error).message}`);
      // Do not claim success: nothing was stored, so the client must keep it pending.
      return fail('SAVE_FAILED', 'Could not save your message. It will be retried.');
    }
  }

  /** Lets a client swap in a fresh access token without dropping the connection. */
  @SubscribeMessage('auth:renew')
  async onRenew(
    @ConnectedSocket() socket: Socket,
    @MessageBody() raw: unknown,
  ): Promise<{ ok: boolean; code?: string }> {
    const user = this.userOf(socket);
    const parsed = renewSchema.safeParse(raw);
    if (!user || !parsed.success) return { ok: false, code: 'INVALID' };
    try {
      const claims = await this.tokens.verify(parsed.data.token);
      if (claims.sub !== user.id) return { ok: false, code: 'USER_MISMATCH' };
      user.exp = claims.exp;
      this.scheduleExpiry(socket, user);
      return { ok: true };
    } catch {
      return { ok: false, code: 'INVALID' };
    }
  }

  private async authenticate(socket: Socket): Promise<void> {
    const ip = socket.handshake.address || 'unknown';
    const attempt = await this.limiter.consume('ws-connect', RateLimitService.fingerprint(ip), 120, 60);
    if (!attempt.allowed) throw handshakeError('RATE_LIMITED', 'too many connections');

    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || token.length > 2100) throw handshakeError('NO_TOKEN');

    let claims;
    try {
      claims = await this.tokens.verify(token);
    } catch (err) {
      throw handshakeError((err as Error).name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN');
    }

    const user = await this.users.findById(claims.sub);
    if (!user) throw handshakeError('INVALID_TOKEN');
    if (user.status !== 'active') throw handshakeError('ACCOUNT_INACTIVE', 'account inactive');
    if (user.must_change_password) throw handshakeError('PASSWORD_CHANGE_REQUIRED', 'password change required');

    const memberships = await this.db.query<{ conversation_id: string }>(
      'SELECT conversation_id FROM conversation_members WHERE user_id = $1',
      [user.id],
    );

    socket.data.user = { id: user.id, displayName: user.display_name, role: user.role, exp: claims.exp } satisfies SocketUser;
    // "user:<id>" lets REST handlers reach this person's sockets on any node;
    // "conv:<id>" rooms are what message broadcasts target.
    await socket.join([`user:${user.id}`, ...memberships.rows.map((m) => `conv:${m.conversation_id}`)]);
  }

  private userOf(socket: Socket): SocketUser | undefined {
    return socket.data.user as SocketUser | undefined;
  }

  /** Closes the socket shortly after its token expires unless the client renews it first. */
  private scheduleExpiry(socket: Socket, user: SocketUser): void {
    const existing = this.expiryTimers.get(socket.id);
    if (existing) clearTimeout(existing);
    const delay = Math.max(1_000, user.exp * 1000 - Date.now() + 2_000);
    const timer = setTimeout(() => {
      socket.emit('auth:expired');
      socket.disconnect(true);
    }, delay);
    timer.unref();
    this.expiryTimers.set(socket.id, timer);
  }
}
