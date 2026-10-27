import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthUser } from '../common/types';
import { DatabaseService } from '../database/database.service';
import { ConnectionsService } from '../people/connections.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { RealtimeBus } from '../realtime/realtime.bus';
import { AccessService } from '../shared/access.service';
import { NotificationsService } from '../shared/notifications.service';
import type { CreateConversationDto, JoinConversationDto } from './conversations.dto';

// No 0/O/1/I/L so codes survive being read aloud or typed from a slide.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

const makeInviteCode = (): string => {
  const pick = (n: number) => Array.from({ length: n }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return `${pick(5)}-${pick(5)}`;
};

export type ConversationKind = 'group' | 'class' | 'direct';

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  offeringId: string | null;
  name: string;
  description: string;
  myRole: 'owner' | 'member';
  /** Only the owner of an ordinary group sees the invite code. */
  inviteCode: string | null;
  memberCount: number;
  createdAt: string;
  peer: { id: string; displayName: string; role: string; title: string | null } | null;
  lastMessage: {
    id: string;
    seq: number;
    body: string;
    createdAt: string;
    senderName: string;
  } | null;
}

interface SummaryRow {
  id: string;
  kind: ConversationKind;
  offering_id: string | null;
  name: string;
  description: string;
  invite_code: string;
  my_role: 'owner' | 'member';
  member_count: number;
  created_at: Date;
  last_id: string | null;
  last_seq: number | null;
  last_body: string | null;
  last_at: Date | null;
  last_sender: string | null;
  peer_id: string | null;
  peer_name: string | null;
  peer_role: string | null;
  peer_title: string | null;
}

const SUMMARY_SQL = `
  SELECT c.id, c.kind, c.offering_id, c.name, c.description, c.invite_code, c.created_at,
         m.role AS my_role,
         (SELECT count(*) FROM conversation_members x WHERE x.conversation_id = c.id) AS member_count,
         lm.id AS last_id, lm.seq AS last_seq, left(lm.body, 140) AS last_body,
         lm.created_at AS last_at, u.display_name AS last_sender,
         peer.id AS peer_id, peer.display_name AS peer_name, peer.role AS peer_role, peer.title AS peer_title
    FROM conversation_members m
    JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN LATERAL (
      SELECT id, seq, body, created_at, sender_id
        FROM messages WHERE conversation_id = c.id ORDER BY seq DESC LIMIT 1
    ) lm ON true
    LEFT JOIN users u ON u.id = lm.sender_id
    LEFT JOIN LATERAL (
      SELECT pu.id, pu.display_name, pu.role, pu.title
        FROM conversation_members pm JOIN users pu ON pu.id = pm.user_id
       WHERE pm.conversation_id = c.id AND pm.user_id <> $1
       LIMIT 1
    ) peer ON c.kind = 'direct'
   WHERE m.user_id = $1`;

const toSummary = (row: SummaryRow): ConversationSummary => ({
  id: row.id,
  kind: row.kind,
  offeringId: row.offering_id,
  name: row.kind === 'direct' ? (row.peer_name ?? 'Conversation') : row.name,
  description: row.description,
  myRole: row.my_role,
  inviteCode: row.kind === 'group' && row.my_role === 'owner' ? row.invite_code : null,
  memberCount: row.member_count,
  createdAt: row.created_at.toISOString(),
  peer: row.peer_id
    ? { id: row.peer_id, displayName: row.peer_name as string, role: row.peer_role as string, title: row.peer_title }
    : null,
  lastMessage: row.last_id
    ? {
        id: row.last_id,
        seq: row.last_seq as number,
        body: row.last_body as string,
        createdAt: (row.last_at as Date).toISOString(),
        senderName: row.last_sender as string,
      }
    : null,
});

@Injectable()
export class ConversationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly limiter: RateLimitService,
    private readonly bus: RealtimeBus,
    private readonly connections: ConnectionsService,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
  ) {}

  async listForUser(userId: string): Promise<ConversationSummary[]> {
    const { rows } = await this.db.query<SummaryRow>(
      `${SUMMARY_SQL} ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
      [userId],
    );
    return rows.map(toSummary);
  }

  async getForUser(userId: string, conversationId: string): Promise<ConversationSummary> {
    const { rows } = await this.db.query<SummaryRow>(`${SUMMARY_SQL} AND c.id = $2`, [userId, conversationId]);
    if (!rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Conversation not found.' });
    return toSummary(rows[0]);
  }

  // ------------------------------------------------------------------ study groups (invite code)

  async create(userId: string, dto: CreateConversationDto): Promise<ConversationSummary> {
    // A unique-violation on the invite code is astronomically unlikely (30^10) but cheap to handle.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const id = await this.db.transaction(async (client) => {
          const created = await client.query<{ id: string }>(
            `INSERT INTO conversations (name, description, invite_code, created_by, kind)
             VALUES ($1, $2, $3, $4, 'group') RETURNING id`,
            [dto.name, dto.description, makeInviteCode(), userId],
          );
          await client.query(
            `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')`,
            [created.rows[0].id, userId],
          );
          return created.rows[0].id;
        });
        await this.bus.addUserToConversation(userId, id);
        return this.getForUser(userId, id);
      } catch (err) {
        if ((err as { code?: string }).code !== '23505') throw err;
      }
    }
    throw new ServiceUnavailableException({ code: 'TRY_AGAIN', message: 'Could not create the group. Try again.' });
  }

  async join(userId: string, dto: JoinConversationDto): Promise<ConversationSummary> {
    // Slows down anyone trying to guess invite codes. Keyed by user, shared by all nodes.
    const attempt = await this.limiter.consume('join', userId, 10, 60, true);
    if (attempt.unavailable) {
      throw new ServiceUnavailableException({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Joining is temporarily unavailable. Please try again shortly.',
      });
    }
    if (!attempt.allowed) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: `Too many attempts. Try again in ${attempt.retryAfterSec} seconds.`,
          retryAfterSec: attempt.retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const found = await this.db.query<{ id: string }>(
      `SELECT id FROM conversations WHERE invite_code = $1 AND kind = 'group'`,
      [dto.inviteCode],
    );
    const conversationId = found.rows[0]?.id;
    if (!conversationId) {
      throw new NotFoundException({ code: 'INVALID_INVITE', message: 'That invite code was not recognised.' });
    }

    await this.db.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role)
       VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [conversationId, userId],
    );
    await this.bus.addUserToConversation(userId, conversationId);
    return this.getForUser(userId, conversationId);
  }

  // ------------------------------------------------------------------ direct messages

  async openDirect(me: AuthUser, otherId: string): Promise<ConversationSummary> {
    if (me.role === 'admin') {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Administrator accounts do not use direct messages.' });
    }
    if (otherId === me.id) throw new BadRequestException({ code: 'SELF', message: 'You cannot message yourself.' });

    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1 AND status = 'active' AND role IN ('student', 'lecturer')`,
      [otherId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'That person could not be found.' });

    const permission = await this.connections.canMessage(me.id, otherId);
    if (!permission.allowed) {
      if (permission.reason === 'blocked') {
        throw new ForbiddenException({ code: 'BLOCKED', message: 'You cannot message this person.' });
      }
      throw new ForbiddenException({
        code: 'CONNECTION_REQUIRED',
        message: 'Send a connection request first. You can chat once it is accepted.',
      });
    }

    const key = [me.id, otherId].sort().join(':');
    const find = async () => {
      const r = await this.db.query<{ id: string }>('SELECT id FROM conversations WHERE direct_key = $1', [key]);
      return r.rows[0]?.id;
    };

    let id = await find();
    if (!id) {
      try {
        id = await this.db.transaction(async (client) => {
          const created = await client.query<{ id: string }>(
            `INSERT INTO conversations (name, description, invite_code, created_by, kind, direct_key)
             VALUES ('', '', $1, $2, 'direct', $3) RETURNING id`,
            [makeInviteCode(), me.id, key],
          );
          await client.query(
            `INSERT INTO conversation_members (conversation_id, user_id, role)
             VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
            [created.rows[0].id, me.id, otherId],
          );
          return created.rows[0].id;
        });
      } catch (err) {
        if ((err as { code?: string }).code !== '23505') throw err;
        id = await find(); // The other person opened it at the same moment.
      }
    }
    if (!id) throw new ServiceUnavailableException({ code: 'TRY_AGAIN', message: 'Could not open the chat. Try again.' });

    await Promise.all([this.bus.addUserToConversation(me.id, id), this.bus.addUserToConversation(otherId, id)]);
    return this.getForUser(me.id, id);
  }

  // ------------------------------------------------------------------ class groups

  /** Creates (once) the chat for a class: the lecturer plus everyone registered for the unit. */
  async createClassGroup(user: AuthUser, offeringId: string): Promise<ConversationSummary> {
    const offering = await this.access.assertTeach(user, offeringId);

    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM conversations WHERE offering_id = $1 AND kind = 'class'`,
      [offeringId],
    );
    let conversationId = existing.rows[0]?.id;

    if (!conversationId) {
      const info = await this.db.query<{ code: string; name: string; term_name: string }>(
        `SELECT un.code, un.name, t.name AS term_name
           FROM offerings o JOIN units un ON un.id = o.unit_id JOIN terms t ON t.id = o.term_id
          WHERE o.id = $1`,
        [offeringId],
      );
      const meta = info.rows[0];
      const title = `${meta.code} · ${meta.name}`.slice(0, 80);
      try {
        conversationId = await this.db.transaction(async (client) => {
          const created = await client.query<{ id: string }>(
            `INSERT INTO conversations (name, description, invite_code, created_by, kind, offering_id)
             VALUES ($1, $2, $3, $4, 'class', $5) RETURNING id`,
            [title, meta.term_name, makeInviteCode(), user.id, offeringId],
          );
          const id = created.rows[0].id;
          if (offering.lecturer_id) {
            await client.query(
              `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')
               ON CONFLICT DO NOTHING`,
              [id, offering.lecturer_id],
            );
          }
          await client.query(
            `INSERT INTO conversation_members (conversation_id, user_id, role)
             SELECT $1, student_id, 'member' FROM enrolments WHERE offering_id = $2 AND status = 'enrolled'
             ON CONFLICT DO NOTHING`,
            [id, offeringId],
          );
          return id;
        });
      } catch (err) {
        if ((err as { code?: string }).code !== '23505') throw err;
        const again = await this.db.query<{ id: string }>(
          `SELECT id FROM conversations WHERE offering_id = $1 AND kind = 'class'`,
          [offeringId],
        );
        conversationId = again.rows[0]?.id;
      }
      if (!conversationId) throw new ServiceUnavailableException({ code: 'TRY_AGAIN', message: 'Could not create the class group.' });

      const members = await this.db.query<{ user_id: string }>(
        'SELECT user_id FROM conversation_members WHERE conversation_id = $1',
        [conversationId],
      );
      await Promise.all(members.rows.map((m) => this.bus.addUserToConversation(m.user_id, conversationId as string)));
      void this.notifications.notifyEnrolled(offeringId, {
        type: 'class_group',
        title: `${meta.code} class chat is open`,
        body: 'Your lecturer started the class group.',
        data: { link: `/app/messages/${conversationId}` },
      });
    }

    // An administrator who is not the lecturer still needs to be a member to open the chat.
    if (user.role === 'admin') {
      await this.db.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
        [conversationId, user.id],
      );
      await this.bus.addUserToConversation(user.id, conversationId);
    }
    return this.getForUser(user.id, conversationId);
  }

  /** Called when a student registers for a unit. A no-op if the class has no chat yet. */
  async addToClassGroup(offeringId: string, userId: string, role: 'owner' | 'member' = 'member'): Promise<void> {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO conversation_members (conversation_id, user_id, role)
       SELECT id, $2, $3 FROM conversations WHERE offering_id = $1 AND kind = 'class'
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING conversation_id AS id`,
      [offeringId, userId, role],
    );
    if (rows[0]) await this.bus.addUserToConversation(userId, rows[0].id);
  }

  async removeFromClassGroup(offeringId: string, userId: string): Promise<void> {
    const { rows } = await this.db.query<{ id: string }>(
      `DELETE FROM conversation_members
        WHERE user_id = $2 AND conversation_id IN (SELECT id FROM conversations WHERE offering_id = $1 AND kind = 'class')
        RETURNING conversation_id AS id`,
      [offeringId, userId],
    );
    if (rows[0]) await this.bus.removeUserFromConversation(userId, rows[0].id);
  }

  // ------------------------------------------------------------------ members

  async listMembers(userId: string, conversationId: string) {
    await this.assertMember(userId, conversationId);
    const { rows } = await this.db.query<{
      id: string;
      display_name: string;
      role: string;
      title: string | null;
      member_role: string;
      joined_at: Date;
    }>(
      `SELECT u.id, u.display_name, u.role, u.title, m.role AS member_role, m.joined_at
         FROM conversation_members m JOIN users u ON u.id = m.user_id
        WHERE m.conversation_id = $1
        ORDER BY (m.role = 'owner') DESC, m.joined_at ASC`,
      [conversationId],
    );
    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      role: r.role,
      title: r.title,
      memberRole: r.member_role,
      joinedAt: r.joined_at.toISOString(),
    }));
  }

  /** 404 rather than 403: non-members cannot tell whether a conversation exists. */
  async assertMember(userId: string, conversationId: string): Promise<void> {
    const { rowCount } = await this.db.query(
      'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [conversationId, userId],
    );
    if (!rowCount) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Conversation not found.' });
  }
}
