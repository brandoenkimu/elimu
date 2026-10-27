import { Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../common/types';
import { cleanText, oneLine, uuid } from '../common/zod-helpers';
import { DatabaseService } from '../database/database.service';
import { FilesService } from '../files/files.service';
import { AccessService } from '../shared/access.service';
import { NotificationsService } from '../shared/notifications.service';

export const materialSchema = z.object({ title: oneLine(140, 2), description: cleanText(500).default(''), fileId: uuid }).strict();
export const announcementSchema = z.object({ title: oneLine(140, 2), body: cleanText(2000, 1) }).strict();
export type MaterialDto = z.infer<typeof materialSchema>;
export type AnnouncementDto = z.infer<typeof announcementSchema>;

@Injectable()
export class ClassroomService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  async materials(user: AuthUser, offeringId: string) {
    await this.access.assertView(user, offeringId);
    const { rows } = await this.db.query(
      `SELECT m.id, m.title, m.description, m.created_at AS "createdAt", f.id AS "fileId", f.name AS "fileName", f.size AS "fileSize"
         FROM materials m JOIN files f ON f.id = m.file_id WHERE m.offering_id = $1 ORDER BY m.created_at DESC`,
      [offeringId],
    );
    return rows;
  }

  async addMaterial(user: AuthUser, offeringId: string, dto: MaterialDto) {
    await this.access.assertTeach(user, offeringId);
    await this.files.attach(user.id, [dto.fileId]);
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO materials (offering_id, title, description, file_id, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [offeringId, dto.title, dto.description, dto.fileId, user.id],
    );
    void this.notifyClass(offeringId, 'material', `New material: ${dto.title}`, user);
    return { id: rows[0].id };
  }

  async removeMaterial(user: AuthUser, id: string) {
    const { rows } = await this.db.query<{ offering_id: string; file_id: string }>('SELECT offering_id, file_id FROM materials WHERE id = $1', [id]);
    if (!rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Material not found.' });
    await this.access.assertTeach(user, rows[0].offering_id);
    await this.db.query('DELETE FROM files WHERE id = $1', [rows[0].file_id]); // cascades to the material row
  }

  async announcements(user: AuthUser, offeringId: string) {
    await this.access.assertView(user, offeringId);
    const { rows } = await this.db.query(
      `SELECT a.id, a.title, a.body, a.created_at AS "createdAt", u.display_name AS "author"
         FROM announcements a JOIN users u ON u.id = a.created_by WHERE a.offering_id = $1 ORDER BY a.created_at DESC LIMIT 100`,
      [offeringId],
    );
    return rows;
  }

  async addAnnouncement(user: AuthUser, offeringId: string, dto: AnnouncementDto) {
    await this.access.assertTeach(user, offeringId);
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO announcements (offering_id, title, body, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
      [offeringId, dto.title, dto.body, user.id],
    );
    void this.notifyClass(offeringId, 'announcement', dto.title, user, dto.body.slice(0, 200));
    return { id: rows[0].id };
  }

  async removeAnnouncement(user: AuthUser, id: string) {
    const { rows } = await this.db.query<{ offering_id: string }>('SELECT offering_id FROM announcements WHERE id = $1', [id]);
    if (!rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Announcement not found.' });
    await this.access.assertTeach(user, rows[0].offering_id);
    await this.db.query('DELETE FROM announcements WHERE id = $1', [id]);
  }

  private async notifyClass(offeringId: string, type: string, title: string, from: AuthUser, body = '') {
    const info = await this.db.query<{ code: string }>(`SELECT un.code FROM offerings o JOIN units un ON un.id = o.unit_id WHERE o.id = $1`, [offeringId]);
    await this.notifications.notifyEnrolled(offeringId, { type, title: `${info.rows[0]?.code ?? 'Class'}: ${title}`, body, data: { link: `/app/classes/${offeringId}` } }, from.id);
  }
}
