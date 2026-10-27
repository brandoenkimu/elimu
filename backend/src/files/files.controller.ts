import { Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AuthUser } from '../common/types';
import { ALLOWED_EXTENSIONS, FilesService, MAX_FILE_BYTES } from './files.service';

@Controller('files')
@UseGuards(AuthGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get('rules')
  rules() {
    return { maxBytes: MAX_FILE_BYTES, extensions: ALLOWED_EXTENSIONS };
  }

  /** Raw upload: the body is the file itself, and X-File-Name carries its URL-encoded name. */
  @Post() @HttpCode(201)
  async upload(@CurrentUser() user: AuthUser, @Headers('x-file-name') name: string | undefined, @Req() req: Request) {
    return { file: await this.files.upload(user, name, req.body) };
  }

  @Get(':id')
  async download(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response) {
    const file = await this.files.download(user, id);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', file.data.length);
    // attachment + nosniff: an uploaded file can never run as a page on this origin.
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file.data);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.files.remove(user, id);
    return { ok: true };
  }
}
