import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../common/roles';
import type { AuthUser } from '../common/types';
import { ZodPipe } from '../common/zod.pipe';
import { AttendanceService, checkInSchema, markSchema, startSessionSchema } from './attendance.service';

const idPipe = new ParseUUIDPipe();
type Start = z.infer<typeof startSessionSchema>;

@Controller()
@UseGuards(AuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('classes/:id/attendance')
  async list(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { return { sessions: await this.attendance.list(u, id) }; }

  @Post('classes/:id/attendance') @Roles('lecturer', 'admin')
  start(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(startSessionSchema)) dto: Start) { return this.attendance.start(u, id, dto); }

  @Post('classes/:id/checkin') @HttpCode(200) @Roles('student')
  checkIn(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(checkInSchema)) dto: { code: string }) { return this.attendance.checkIn(u, id, dto.code); }

  @Get('attendance/:id') @Roles('lecturer', 'admin')
  roster(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { return this.attendance.roster(u, id); }

  @Post('attendance/:id/close') @HttpCode(200) @Roles('lecturer', 'admin')
  async close(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { await this.attendance.close(u, id); return { ok: true }; }

  @Put('attendance/:id/students/:studentId') @Roles('lecturer', 'admin')
  async mark(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Param('studentId', idPipe) sid: string, @Body(new ZodPipe(markSchema)) dto: { present: boolean }) {
    await this.attendance.mark(u, id, sid, dto.present);
    return { ok: true };
  }

  @Get('attendance/:id/export.csv') @Roles('lecturer', 'admin')
  async csv(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Res() res: Response) {
    const csv = await this.attendance.csv(u, id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }
}
