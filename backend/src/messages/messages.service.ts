import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/types';
import { DatabaseService } from '../database/database.service';
import { ConnectionsService } from '../people/connections.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { RealtimeBus } from '../realtime/realtime.bus';
import type { HistoryQuery } from './messages.dto';

export interface ReactionWire {
  emoji: string;
  userIds: string[];
}

/** A short preview of the message being replied to. */
export interface ReplyWire {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  deleted: boolean;
}

/** The shape clients receive, both from the REST history endpoint and over the socket. */
export interface WireMessage {
  id: string;
  seq: number;
  conversationId: string;
  clientMessageId: string;
  body: string;
  createdAt: string;
  originNode: string;
  sender: { id: string; displayName: string; role: string };
  replyTo: ReplyWire | null;
  deleted: boolean;
  reactions: ReactionWire[];
}

interface MessageRow {
  id: string;
  seq: number;
  conversation_id: string;
  sender_id: string;
  client_message_id: string;
  body: string;
  origin_node: string;
  created_at: Date;
  reply_to_id: string | null;
  deleted_at: Date | null;
  display_name: string;
  role: string;
}

const toWire = (row: MessageRow, replyTo: ReplyWire | null, reactions: ReactionWire[]): WireMessage => ({
  id: row.id,
  seq: row.seq,
  conversationId: row.conversation_id,
  clientMessageId: row.client_message_id,
  body: row.deleted_at ? '' : row.body,
  createdAt: row.created_at.toISOString(),
  originNode: row.origin_node,
  sender: { id: row.sender_id, displayName: row.display_name, role: row.role },
  replyTo: row.deleted_at ? null : replyTo,
  deleted: !!row.deleted_at,
  reactions: row.deleted_at ? [] : reactions,
});

const MAX_REACTION_KINDS = 30;

export interface SendInput {
  conversationId: string;
  clientMessageId: string;
  body: string;
  replyToId?: string;
  originNode: string;
  sender: { id: string; displayName: string; role: string };
}

const SELECT_COLUMNS = `m.id, m.seq, m.conversation_id, m.sender_id, m.client_message_id, m.body,
                        m.origin_node, m.created_at, m.reply_to_id, m.deleted_at, u.display_name, u.role`;

@Injectable()
export class MessagesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly connections: ConnectionsService,
    private readonly limiter: RateLimitService,
    private readonly bus: RealtimeBus,
  ) {}

  /** Adds reply previews and reactions to a batch of rows, using two queries however many rows there are. */
  private async hydrate(rows: MessageRow[]): Promise<WireMessage[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const replyIds = [...new Set(rows.map((r) => r.reply_to_id).filter((x): x is string => !!x))];

    const replies = new Map<string, ReplyWire>();
    if (replyIds.length) {
      const { rows: found } = await this.db.query<{ id: string; sender_id: string; display_name: string; body: string; deleted_at: Date | null }>(
        `SELECT m.id, m.sender_id, u.display_name, m.body, m.deleted_at
           FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ANY($1::uuid[])`,
        [replyIds],
      );
      for (const r of found) {
        replies.set(r.id, { id: r.id, senderId: r.sender_id, senderName: r.display_name, body: r.deleted_at ? '' : r.body.slice(0, 160), deleted: !!r.deleted_at });
      }
    }

    const reactions = await this.reactionsFor(ids);
    return rows.map((r) => toWire(r, r.reply_to_id ? replies.get(r.reply_to_id) ?? null : null, reactions.get(r.id) ?? []));
  }

  private async reactionsFor(messageIds: string[]): Promise<Map<string, ReactionWire[]>> {
    const { rows } = await this.db.query<{ message_id: string; emoji: string; user_ids: string[] }>(
      `SELECT message_id, emoji, array_agg(user_id::text ORDER BY created_at) AS user_ids
         FROM message_reactions WHERE message_id = ANY($1::uuid[])
        GROUP BY message_id, emoji ORDER BY min(created_at)`,
      [messageIds],
    );
    const map = new Map<string, ReactionWire[]>();
    for (const r of rows) {
      const list = map.get(r.message_id) ?? [];
      list.push({ emoji: r.emoji, userIds: r.user_ids });
      map.set(r.message_id, list);
    }
    return map;
  }

  private async limit(userId: string): Promise<void> {
    const r = await this.limiter.consume('msg-action', userId, 60, 10);
    if (!r.allowed) throw new HttpException({ code: 'RATE_LIMITED', message: 'Slow down a little.' }, HttpStatus.TOO_MANY_REQUESTS);
  }

  /** Throws unless the user is in the conversation. Returns their role there. */
  private async membership(userId: string, conversationId: string): Promise<{ role: string; kind: string }> {
    const { rows } = await this.db.query<{ role: string; kind: string }>(
      `SELECT cm.role, c.kind FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id
        WHERE cm.conversation_id = $1 AND cm.user_id = $2`,
      [conversationId, userId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Conversation not found.' });
    return rows[0];
  }

  /**
   * Deletes a message for everyone. The text is erased, not just hidden.
   * Allowed: the sender; the owner of a class or group (moderation); an administrator who is a member.
   */
  async remove(user: AuthUser, conversationId: string, messageId: string): Promise<void> {
    await this.limit(user.id);
    const me = await this.membership(user.id, conversationId);
    const { rows } = await this.db.query<{ sender_id: string; deleted_at: Date | null }>(
      'SELECT sender_id, deleted_at FROM messages WHERE id = $1 AND conversation_id = $2',
      [messageId, conversationId],
    );
    const msg = rows[0];
    if (!msg) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Message not found.' });
    if (msg.deleted_at) return;
    const allowed = msg.sender_id === user.id || user.role === 'admin' || (me.kind !== 'direct' && me.role === 'owner');
    if (!allowed) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You can only delete your own messages.' });
    await this.db.transaction(async (client) => {
      await client.query(`UPDATE messages SET body = '', deleted_at = now(), deleted_by = $2 WHERE id = $1 AND deleted_at IS NULL`, [messageId, user.id]);
      await client.query('DELETE FROM message_reactions WHERE message_id = $1', [messageId]);
    });
    this.bus.emitToConversation(conversationId, 'message:deleted', { conversationId, messageId });
  }

  /** Adds your reaction, or removes it if you already reacted with the same emoji. */
  async toggleReaction(user: AuthUser, conversationId: string, messageId: string, emoji: string): Promise<ReactionWire[]> {
    await this.limit(user.id);
    await this.membership(user.id, conversationId);
    await this.assertDirectAllowed(conversationId, user.id);
    const { rows } = await this.db.query<{ deleted_at: Date | null }>('SELECT deleted_at FROM messages WHERE id = $1 AND conversation_id = $2', [messageId, conversationId]);
    if (!rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Message not found.' });
    if (rows[0].deleted_at) throw new ConflictException({ code: 'DELETED', message: 'That message was deleted.' });

    const removed = await this.db.query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [messageId, user.id, emoji]);
    if (!removed.rowCount) {
      const kinds = await this.db.query<{ n: number; has: boolean }>(
        `SELECT count(DISTINCT emoji) AS n, bool_or(emoji = $2) AS has FROM message_reactions WHERE message_id = $1`,
        [messageId, emoji],
      );
      if (!kinds.rows[0].has && Number(kinds.rows[0].n) >= MAX_REACTION_KINDS) {
        throw new ConflictException({ code: 'TOO_MANY_REACTIONS', message: 'This message has the maximum number of different reactions.' });
      }
      await this.db.query('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [messageId, user.id, emoji]);
    }
    const reactions = (await this.reactionsFor([messageId])).get(messageId) ?? [];
    this.bus.emitToConversation(conversationId, 'message:reactions', { conversationId, messageId, reactions });
    return reactions;
  }

  /**
   * Saves a message exactly once.
   *
   * One statement does the membership check and the insert, so there is no gap
   * between "is this user allowed" and "write it". The UNIQUE (sender_id,
   * client_message_id) constraint turns a retry into a no-op, after which we
   * return the row that was saved the first time (duplicate = true).
   */
  async save(input: SendInput): Promise<{ message: WireMessage; duplicate: boolean }> {
    await this.assertDirectAllowed(input.conversationId, input.sender.id);
    if (input.replyToId) {
      // A reply must point at a message in the same conversation.
      const target = await this.db.query('SELECT 1 FROM messages WHERE id = $1 AND conversation_id = $2', [input.replyToId, input.conversationId]);
      if (!target.rowCount) throw new BadRequestException({ code: 'REPLY_INVALID', message: 'The message you are replying to no longer exists.' });
    }
    const inserted = await this.db.query<Omit<MessageRow, 'display_name' | 'role'>>(
      `INSERT INTO messages (conversation_id, sender_id, client_message_id, body, origin_node, reply_to_id)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::uuid
        WHERE EXISTS (
          SELECT 1 FROM conversation_members WHERE conversation_id = $1::uuid AND user_id = $2::uuid
        )
       ON CONFLICT (sender_id, client_message_id) DO NOTHING
       RETURNING id, seq, conversation_id, sender_id, client_message_id, body, origin_node, created_at, reply_to_id, deleted_at`,
      [input.conversationId, input.sender.id, input.clientMessageId, input.body, input.originNode, input.replyToId ?? null],
    );

    if (inserted.rows[0]) {
      const [message] = await this.hydrate([{ ...inserted.rows[0], display_name: input.sender.displayName, role: input.sender.role }]);
      return { message, duplicate: false };
    }

    // No row inserted: either this is a retry, or the sender is not a member.
    const existing = await this.db.query<MessageRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.sender_id = $1 AND m.client_message_id = $2`,
      [input.sender.id, input.clientMessageId],
    );
    const row = existing.rows[0];
    if (!row) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You are not a member of this conversation.' });
    }
    if (row.conversation_id !== input.conversationId) {
      throw new ConflictException({ code: 'CLIENT_ID_REUSED', message: 'That message id was already used.' });
    }
    const [message] = await this.hydrate([row]);
    return { message, duplicate: true };
  }

  /** A blocked person cannot be messaged, even in a conversation that already exists. */
  private async assertDirectAllowed(conversationId: string, senderId: string): Promise<void> {
    const { rows } = await this.db.query<{ other: string }>(
      `SELECT m.user_id AS other FROM conversations c
         JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id <> $2
        WHERE c.id = $1 AND c.kind = 'direct'`,
      [conversationId, senderId],
    );
    if (!rows[0]) return;
    const permission = await this.connections.canMessage(senderId, rows[0].other);
    if (!permission.allowed) {
      throw new ForbiddenException({ code: 'CANNOT_MESSAGE', message: 'You can no longer message this person.' });
    }
  }

  /**
   * Message history for a member.
   *  - no cursor : the latest `limit` messages
   *  - before    : `limit` messages older than that seq (scrolling up)
   *  - after     : messages newer than that seq (catching up after a reconnect)
   * Results are always returned oldest-first.
   */
  async history(userId: string, conversationId: string, query: HistoryQuery) {
    const member = await this.db.query('SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [
      conversationId,
      userId,
    ]);
    if (!member.rowCount) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Conversation not found.' });

    const columns = SELECT_COLUMNS;

    if (query.after !== undefined) {
      const { rows } = await this.db.query<MessageRow>(
        `SELECT ${columns} FROM messages m JOIN users u ON u.id = m.sender_id
          WHERE m.conversation_id = $1 AND m.seq > $2
          ORDER BY m.seq ASC LIMIT $3`,
        [conversationId, query.after, query.limit + 1],
      );
      const hasMore = rows.length > query.limit;
      return { messages: await this.hydrate(rows.slice(0, query.limit)), hasMore };
    }

    const { rows } = await this.db.query<MessageRow>(
      `SELECT ${columns} FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = $1 AND ($2::bigint IS NULL OR m.seq < $2::bigint)
        ORDER BY m.seq DESC LIMIT $3`,
      [conversationId, query.before ?? null, query.limit + 1],
    );
    const hasMore = rows.length > query.limit;
    return { messages: await this.hydrate(rows.slice(0, query.limit).reverse()), hasMore };
  }
}
