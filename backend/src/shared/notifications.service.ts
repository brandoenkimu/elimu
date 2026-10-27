import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RealtimeBus } from '../realtime/realtime.bus';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  /** Free-form payload; the web app uses data.link to know where a click should go. */
  data?: Record<string, unknown>;
}

export interface WireNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
}

const toWire = (r: NotificationRow): WireNotification => ({
  id: r.id,
  type: r.type,
  title: r.title,
  body: r.body,
  data: r.data,
  readAt: r.read_at ? r.read_at.toISOString() : null,
  createdAt: r.created_at.toISOString(),
});

@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');

  constructor(
    private readonly db: DatabaseService,
    private readonly bus: RealtimeBus,
  ) {}

  /** Stores a notification for each user and pushes it live to any open session. Never throws. */
  async notify(userIds: string[], input: NotificationInput): Promise<void> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    try {
      const { rows } = await this.db.query<NotificationRow>(
        `INSERT INTO notifications (user_id, type, title, body, data)
         SELECT u, $2, $3, $4, $5::jsonb FROM unnest($1::uuid[]) AS u
         RETURNING id, user_id, type, title, body, data, read_at, created_at`,
        [ids, input.type, input.title.slice(0, 140), (input.body ?? '').slice(0, 300), JSON.stringify(input.data ?? {})],
      );
      for (const row of rows) this.bus.emitToUser(row.user_id, 'notify:new', toWire(row));
    } catch (err) {
      this.log.warn(`Could not create "${input.type}" notification: ${(err as Error).message}`);
    }
  }

  async notifyRole(role: 'admin' | 'lecturer' | 'student', input: NotificationInput): Promise<void> {
    try {
      const { rows } = await this.db.query<{ id: string }>(`SELECT id FROM users WHERE role = $1 AND status = 'active'`, [role]);
      await this.notify(
        rows.map((r) => r.id),
        input,
      );
    } catch (err) {
      this.log.warn(`Could not notify ${role}s: ${(err as Error).message}`);
    }
  }

  async notifyEnrolled(offeringId: string, input: NotificationInput, exceptUserId?: string): Promise<void> {
    try {
      const { rows } = await this.db.query<{ student_id: string }>(
        `SELECT student_id FROM enrolments WHERE offering_id = $1 AND status = 'enrolled'`,
        [offeringId],
      );
      await this.notify(
        rows.map((r) => r.student_id).filter((id) => id !== exceptUserId),
        input,
      );
    } catch (err) {
      this.log.warn(`Could not notify class: ${(err as Error).message}`);
    }
  }

  async list(userId: string, limit: number, before?: string) {
    const { rows } = await this.db.query<NotificationRow>(
      `SELECT id, user_id, type, title, body, data, read_at, created_at
         FROM notifications
        WHERE user_id = $1 AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
        ORDER BY created_at DESC LIMIT $3`,
      [userId, before ?? null, limit],
    );
    return { notifications: rows.map(toWire), unread: await this.unreadCount(userId) };
  }

  async unreadCount(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      'SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [userId],
    );
    return rows[0]?.n ?? 0;
  }

  async markRead(userId: string, ids: string[] | null): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE notifications SET read_at = now()
        WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`,
      [userId, ids],
    );
    return rowCount ?? 0;
  }
}
