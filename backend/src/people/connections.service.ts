import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/types';
import { DatabaseService } from '../database/database.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { NotificationsService } from '../shared/notifications.service';

export type Relation = 'none' | 'friends' | 'incoming' | 'outgoing' | 'blocked_by_me' | 'blocked';

export interface RelationInfo {
  relation: Relation;
  connectionId: string | null;
}

export interface PersonCard {
  id: string;
  displayName: string;
  role: 'student' | 'lecturer';
  title: string | null;
  department: string | null;
  courseName: string | null;
  yearOfStudy: number | null;
}

interface CardRow {
  id: string;
  display_name: string;
  role: 'student' | 'lecturer';
  title: string | null;
  department: string | null;
  course_name: string | null;
  year_of_study: number | null;
}

export const CARD_COLUMNS = `u.id, u.display_name, u.role, u.title, u.department, c.name AS course_name, u.year_of_study`;
export const CARD_FROM = `users u LEFT JOIN courses c ON c.id = u.course_id`;

export const toCard = (r: CardRow): PersonCard => ({
  id: r.id,
  displayName: r.display_name,
  role: r.role,
  title: r.title,
  department: r.department,
  courseName: r.course_name,
  yearOfStudy: r.year_of_study,
});

export interface ConnectionItem {
  id: string;
  status: 'pending' | 'accepted';
  direction: 'incoming' | 'outgoing';
  note: string;
  createdAt: string;
  user: PersonCard;
}

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly limiter: RateLimitService,
    private readonly notifications: NotificationsService,
  ) {}

  /** How `me` stands with each of the given people. */
  async relations(meId: string, otherIds: string[]): Promise<Map<string, RelationInfo>> {
    const out = new Map<string, RelationInfo>();
    for (const id of otherIds) out.set(id, { relation: 'none', connectionId: null });
    if (otherIds.length === 0) return out;

    const { rows } = await this.db.query<{ id: string; requester_id: string; addressee_id: string; status: string }>(
      `SELECT id, requester_id, addressee_id, status FROM connections
        WHERE (requester_id = $1 AND addressee_id = ANY($2::uuid[]))
           OR (addressee_id = $1 AND requester_id = ANY($2::uuid[]))`,
      [meId, otherIds],
    );
    for (const r of rows) {
      const iAmRequester = r.requester_id === meId;
      const otherId = iAmRequester ? r.addressee_id : r.requester_id;
      let relation: Relation = 'none';
      if (r.status === 'accepted') relation = 'friends';
      else if (r.status === 'pending') relation = iAmRequester ? 'outgoing' : 'incoming';
      else if (r.status === 'blocked') relation = iAmRequester ? 'blocked_by_me' : 'blocked';
      out.set(otherId, { relation, connectionId: r.id });
    }
    return out;
  }

  /** Accepted connection, or a teacher/student pair who share a class. */
  async canMessage(aId: string, bId: string): Promise<{ allowed: boolean; reason?: 'blocked' | 'request_needed' }> {
    const rel = (await this.relations(aId, [bId])).get(bId)!;
    if (rel.relation === 'blocked' || rel.relation === 'blocked_by_me') return { allowed: false, reason: 'blocked' };
    if (rel.relation === 'friends') return { allowed: true };

    const { rowCount } = await this.db.query(
      `SELECT 1 FROM offerings o
         JOIN enrolments e ON e.offering_id = o.id AND e.status = 'enrolled'
        WHERE (o.lecturer_id = $1 AND e.student_id = $2) OR (o.lecturer_id = $2 AND e.student_id = $1)
        LIMIT 1`,
      [aId, bId],
    );
    return rowCount ? { allowed: true } : { allowed: false, reason: 'request_needed' };
  }

  async list(me: AuthUser): Promise<{ connections: ConnectionItem[]; blocked: PersonCard[] }> {
    const { rows } = await this.db.query<
      CardRow & { cid: string; status: string; requester_id: string; note: string; created_at: Date }
    >(
      `SELECT ${CARD_COLUMNS}, k.id AS cid, k.status, k.requester_id, k.note, k.created_at
         FROM connections k
         JOIN users u ON u.id = CASE WHEN k.requester_id = $1 THEN k.addressee_id ELSE k.requester_id END
         LEFT JOIN courses c ON c.id = u.course_id
        WHERE (k.requester_id = $1 OR k.addressee_id = $1)
          AND k.status IN ('pending', 'accepted', 'blocked')
          AND u.status = 'active'
        ORDER BY k.created_at DESC`,
      [me.id],
    );
    const connections: ConnectionItem[] = [];
    const blocked: PersonCard[] = [];
    for (const r of rows) {
      if (r.status === 'blocked') {
        if (r.requester_id === me.id) blocked.push(toCard(r));
        continue;
      }
      connections.push({
        id: r.cid,
        status: r.status as 'pending' | 'accepted',
        direction: r.requester_id === me.id ? 'outgoing' : 'incoming',
        note: r.note,
        createdAt: r.created_at.toISOString(),
        user: toCard(r),
      });
    }
    return { connections, blocked };
  }

  async send(me: AuthUser, targetId: string, note: string): Promise<{ status: 'pending' | 'accepted'; id: string }> {
    if (targetId === me.id) throw new BadRequestException({ code: 'SELF', message: 'You cannot connect with yourself.' });

    const { rows: targets } = await this.db.query<{ id: string; role: string; status: string; allow: string | null }>(
      `SELECT id, role, status, preferences->>'allowRequests' AS allow FROM users WHERE id = $1`,
      [targetId],
    );
    const target = targets[0];
    if (!target || target.status !== 'active' || target.role === 'admin') {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That person could not be found.' });
    }

    const limit = await this.limiter.consume('conn-request', me.id, 30, 24 * 3600);
    if (!limit.allowed) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'You have sent a lot of requests today. Try again tomorrow.', retryAfterSec: limit.retryAfterSec },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const existing = (await this.relations(me.id, [targetId])).get(targetId)!;
    switch (existing.relation) {
      case 'friends':
        throw new ConflictException({ code: 'ALREADY_CONNECTED', message: 'You are already connected.' });
      case 'outgoing':
        throw new ConflictException({ code: 'ALREADY_REQUESTED', message: 'You already sent this person a request.' });
      case 'blocked':
      case 'blocked_by_me':
        throw new ForbiddenException({ code: 'BLOCKED', message: 'You cannot send a request to this person.' });
      case 'incoming': {
        // They already asked us. Sending a request back just accepts theirs.
        await this.respond(me, existing.connectionId!, true);
        return { status: 'accepted', id: existing.connectionId! };
      }
      default:
        break;
    }

    if (target.allow === 'false') {
      throw new ForbiddenException({ code: 'REQUESTS_OFF', message: 'This person is not accepting connection requests.' });
    }

    // A previously declined pair may try again: reuse the row so the pair stays unique.
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO connections (requester_id, addressee_id, status, note)
       VALUES ($1, $2, 'pending', $3)
       ON CONFLICT ((LEAST(requester_id, addressee_id)), (GREATEST(requester_id, addressee_id)))
       DO UPDATE SET requester_id = EXCLUDED.requester_id, addressee_id = EXCLUDED.addressee_id,
                     status = 'pending', note = EXCLUDED.note, created_at = now(), responded_at = NULL
         WHERE connections.status = 'declined'
       RETURNING id`,
      [me.id, targetId, note],
    );
    if (!rows[0]) throw new ConflictException({ code: 'ALREADY_REQUESTED', message: 'A request already exists.' });

    void this.notifications.notify([targetId], {
      type: 'connection_request',
      title: `${me.displayName} wants to connect`,
      body: note || 'Accept to start chatting.',
      data: { link: '/app/people?tab=requests', userId: me.id },
    });
    return { status: 'pending', id: rows[0].id };
  }

  async respond(me: AuthUser, connectionId: string, accept: boolean): Promise<void> {
    const { rows } = await this.db.query<{ requester_id: string }>(
      `UPDATE connections SET status = $3, responded_at = now()
        WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
        RETURNING requester_id`,
      [connectionId, me.id, accept ? 'accepted' : 'declined'],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'That request is no longer available.' });
    if (accept) {
      void this.notifications.notify([rows[0].requester_id], {
        type: 'connection_accepted',
        title: `${me.displayName} accepted your request`,
        body: 'You can now send each other messages.',
        data: { link: `/app/people/${me.id}`, userId: me.id },
      });
    }
  }

  /** Cancels your own pending request or removes an existing connection. */
  async remove(me: AuthUser, connectionId: string): Promise<void> {
    const { rowCount } = await this.db.query(
      `DELETE FROM connections
        WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2) AND status <> 'blocked'`,
      [connectionId, me.id],
    );
    if (!rowCount) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Connection not found.' });
  }

  async block(me: AuthUser, targetId: string): Promise<void> {
    if (targetId === me.id) throw new BadRequestException({ code: 'SELF', message: 'You cannot block yourself.' });
    const { rowCount } = await this.db.query(`SELECT 1 FROM users WHERE id = $1 AND role <> 'admin'`, [targetId]);
    if (!rowCount) throw new NotFoundException({ code: 'NOT_FOUND', message: 'That person could not be found.' });
    await this.db.transaction(async (client) => {
      await client.query(
        `DELETE FROM connections
          WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
        [me.id, targetId],
      );
      await client.query(
        `INSERT INTO connections (requester_id, addressee_id, status, responded_at) VALUES ($1, $2, 'blocked', now())`,
        [me.id, targetId],
      );
    });
  }

  async unblock(me: AuthUser, targetId: string): Promise<void> {
    await this.db.query(
      `DELETE FROM connections WHERE requester_id = $1 AND addressee_id = $2 AND status = 'blocked'`,
      [me.id, targetId],
    );
  }
}
