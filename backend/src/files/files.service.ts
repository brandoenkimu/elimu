import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { AuthUser } from '../common/types';
import { DatabaseService } from '../database/database.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { AccessService } from '../shared/access.service';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Extension → what we serve it as. The client's Content-Type is never trusted. */
const TYPES: Record<string, { mime: string; magic?: number[][]; text?: boolean }> = {
  pdf: { mime: 'application/pdf', magic: [[0x25, 0x50, 0x44, 0x46]] },
  png: { mime: 'image/png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  jpg: { mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  jpeg: { mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: [[0x50, 0x4b, 0x03, 0x04]] },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: [[0x50, 0x4b, 0x03, 0x04]] },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: [[0x50, 0x4b, 0x03, 0x04]] },
  doc: { mime: 'application/msword', magic: [[0xd0, 0xcf, 0x11, 0xe0]] },
  xls: { mime: 'application/vnd.ms-excel', magic: [[0xd0, 0xcf, 0x11, 0xe0]] },
  ppt: { mime: 'application/vnd.ms-powerpoint', magic: [[0xd0, 0xcf, 0x11, 0xe0]] },
  zip: { mime: 'application/zip', magic: [[0x50, 0x4b, 0x03, 0x04]] },
  txt: { mime: 'text/plain; charset=utf-8', text: true },
  csv: { mime: 'text/csv; charset=utf-8', text: true },
  md: { mime: 'text/plain; charset=utf-8', text: true },
};

export const ALLOWED_EXTENSIONS = Object.keys(TYPES);

const cleanName = (raw: string): string => {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const name = base.normalize('NFC').replace(/[\u0000-\u001F\u007F"<>:|?*‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  return name.slice(-120);
};

export interface FileMeta {
  id: string;
  name: string;
  size: number;
  mime: string;
}

@Injectable()
export class FilesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Files');
  private sweeper?: NodeJS.Timeout;

  constructor(
    private readonly db: DatabaseService,
    private readonly limiter: RateLimitService,
    private readonly access: AccessService,
  ) {}

  onModuleInit(): void {
    // Uploads that were never attached to anything are removed after an hour.
    this.sweeper = setInterval(() => {
      this.db.query(`DELETE FROM files WHERE NOT attached AND created_at < now() - interval '1 hour'`).catch((e: Error) => this.log.warn(`Sweep failed: ${e.message}`));
    }, 15 * 60_000);
    this.sweeper.unref();
  }

  onModuleDestroy(): void {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  async upload(user: AuthUser, rawName: string | undefined, body: unknown): Promise<FileMeta> {
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException({ code: 'EMPTY_FILE', message: 'Choose a file to upload.' });
    }
    const limit = await this.limiter.consume('upload', user.id, 30, 600);
    if (!limit.allowed) {
      throw new HttpException({ code: 'RATE_LIMITED', message: 'You are uploading too quickly. Try again shortly.', retryAfterSec: limit.retryAfterSec }, HttpStatus.TOO_MANY_REQUESTS);
    }

    let decoded = '';
    try { decoded = decodeURIComponent(rawName ?? ''); } catch { decoded = ''; }
    const name = cleanName(decoded);
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
    const type = TYPES[ext];
    if (!name || !type) {
      throw new BadRequestException({ code: 'FILE_TYPE', message: `That file type is not allowed. Use: ${ALLOWED_EXTENSIONS.join(', ')}.` });
    }
    if (body.length > MAX_FILE_BYTES) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'Files can be at most 10 MB.' });
    }
    if (type.magic && !type.magic.some((sig) => sig.every((b, i) => body[i] === b))) {
      throw new BadRequestException({ code: 'FILE_CONTENT', message: 'The file does not look like a real .' + ext + ' file.' });
    }
    if (type.text && body.subarray(0, 4096).includes(0)) {
      throw new BadRequestException({ code: 'FILE_CONTENT', message: 'That does not look like a text file.' });
    }

    const sha = createHash('sha256').update(body).digest('hex');
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO files (owner_id, name, mime, size, sha256, data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [user.id, name, type.mime, body.length, sha, body],
    );
    return { id: rows[0].id, name, size: body.length, mime: type.mime };
  }

  /** Marks uploaded files as in use so the sweeper keeps them. Only the uploader's own files qualify. */
  async attach(ownerId: string, fileIds: string[]): Promise<void> {
    if (!fileIds.length) return;
    const r = await this.db.query(`UPDATE files SET attached = true WHERE owner_id = $1 AND id = ANY($2::uuid[])`, [ownerId, fileIds]);
    if (r.rowCount !== new Set(fileIds).size) {
      throw new BadRequestException({ code: 'FILE_NOT_FOUND', message: 'An uploaded file could not be found. Upload it again.' });
    }
  }

  async meta(ids: string[]): Promise<FileMeta[]> {
    if (!ids.length) return [];
    const { rows } = await this.db.query<FileMeta>(`SELECT id, name, size, mime FROM files WHERE id = ANY($1::uuid[])`, [ids]);
    return rows;
  }

  async download(user: AuthUser, id: string): Promise<{ name: string; mime: string; data: Buffer }> {
    const { rows } = await this.db.query<{ name: string; mime: string; data: Buffer; owner_id: string }>(
      'SELECT name, mime, data, owner_id FROM files WHERE id = $1',
      [id],
    );
    const file = rows[0];
    if (!file || !(await this.canRead(user, id, file.owner_id))) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'File not found.' });
    }
    return file;
  }

  private async canRead(user: AuthUser, fileId: string, ownerId: string): Promise<boolean> {
    if (user.role === 'admin' || ownerId === user.id) return true;
    const shared = await this.db.query<{ offering_id: string; teachers_only: boolean }>(
      `SELECT offering_id, false AS teachers_only FROM materials WHERE file_id = $1
       UNION ALL SELECT offering_id, false FROM assessments WHERE brief_file_id = $1 AND status <> 'draft'
       UNION ALL SELECT a.offering_id, true FROM submission_files sf
                   JOIN submissions s ON s.id = sf.submission_id JOIN assessments a ON a.id = s.assessment_id
                  WHERE sf.file_id = $1`,
      [fileId],
    );
    for (const row of shared.rows) {
      try {
        if (row.teachers_only) await this.access.assertTeach(user, row.offering_id);
        else await this.access.assertView(user, row.offering_id);
        return true;
      } catch (err) {
        if (!(err instanceof ForbiddenException || err instanceof NotFoundException)) throw err;
      }
    }
    return false;
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const r = await this.db.query('DELETE FROM files WHERE id = $1 AND owner_id = $2 AND NOT attached', [id, user.id]);
    if (!r.rowCount) throw new NotFoundException({ code: 'NOT_FOUND', message: 'File not found.' });
  }
}
