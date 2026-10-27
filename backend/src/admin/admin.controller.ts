import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../common/roles';
import type { AuthUser } from '../common/types';
import { ZodPipe } from '../common/zod.pipe';
import { CreateUserDto, ListUsersQuery, UpdateUserDto, createUserSchema, listUsersSchema, updateUserSchema } from './admin.dto';
import { AdminService } from './admin.service';

const auditQuery = z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const idPipe = new ParseUUIDPipe();

@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats') stats() { return this.admin.stats(); }

  @Get('users') users(@Query(new ZodPipe(listUsersSchema)) q: ListUsersQuery) { return this.admin.listUsers(q); }
  @Post('users') createUser(@CurrentUser() u: AuthUser, @Ip() ip: string, @Body(new ZodPipe(createUserSchema)) dto: CreateUserDto) { return this.admin.createUser(u, dto, ip); }
  @Get('users/:id') user(@Param('id', idPipe) id: string) { return this.admin.getUser(id); }
  @Patch('users/:id')
  async update(@CurrentUser() u: AuthUser, @Ip() ip: string, @Param('id', idPipe) id: string, @Body(new ZodPipe(updateUserSchema)) dto: UpdateUserDto) {
    await this.admin.updateUser(u, id, dto, ip);
    return { ok: true };
  }
  @Post('users/:id/reset-password') @HttpCode(200)
  resetPassword(@CurrentUser() u: AuthUser, @Ip() ip: string, @Param('id', idPipe) id: string) { return this.admin.resetPassword(u, id, ip); }

  @Get('audit') audit(@Query(new ZodPipe(auditQuery)) q: { before?: number; limit: number }) { return this.admin.auditLog(q.before, q.limit); }

  @Get('reports/:kind.csv')
  async report(@CurrentUser() u: AuthUser, @Param('kind') kind: string, @Res() res: Response) {
    const role = kind === 'lecturers' ? 'lecturer' : 'student';
    const csv = await this.admin.usersCsv(u, role);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${role}s.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }
}
