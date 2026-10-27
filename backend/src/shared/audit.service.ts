import { Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '../common/types';
import { DatabaseService } from '../database/database.service';

export interface AuditEntry {
  id: number;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown>;
  ip: string;
  createdAt: string;
}

/** Append-only record of administrative actions. Never blocks the action it describes. */
@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');

  constructor(private readonly db: DatabaseService) {}

  async record(
    actor: Pick<AuthUser, 'id' | 'displayName'> | null,
    action: string,
    target?: { type: string; id: string },
    detail: Record<string, unknown> = {},
    ip = '',
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO audit_log (actor_id, actor_name, action, target_type, target_id, detail, ip)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          actor?.id ?? null,
          actor?.displayName ?? 'System',
          action,
          target?.type ?? '',
          target?.id ?? '',
          JSON.stringify(detail),
          ip.slice(0, 64),
        ],
      );
    } catch (err) {
      this.log.warn(`Could not write audit entry "${action}": ${(err as Error).message}`);
    }
  }

  async list(before: number | undefined, limit: number): Promise<{ entries: AuditEntry[]; nextBefore: number | null }> {
    const { rows } = await this.db.query<{
      id: number;
      actor_name: string;
      action: string;
      target_type: string;
      target_id: string;
      detail: Record<string, unknown>;
      ip: string;
      created_at: Date;
    }>(
      `SELECT id, actor_name, action, target_type, target_id, detail, ip, created_at
         FROM audit_log
        WHERE ($1::bigint IS NULL OR id < $1::bigint)
        ORDER BY id DESC LIMIT $2`,
      [before ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return {
      entries: page.map((r) => ({
        id: r.id,
        actorName: r.actor_name,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        detail: r.detail,
        ip: r.ip,
        createdAt: r.created_at.toISOString(),
      })),
      nextBefore: rows.length > limit ? page[page.length - 1].id : null,
    };
  }
}
