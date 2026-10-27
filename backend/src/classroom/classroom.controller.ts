import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../common/roles';
import type { AuthUser } from '../common/types';
import { ZodPipe } from '../common/zod.pipe';
import { AnnouncementDto, ClassroomService, MaterialDto, announcementSchema, materialSchema } from './classroom.service';

const idPipe = new ParseUUIDPipe();

@Controller()
@UseGuards(AuthGuard, RolesGuard)
export class ClassroomController {
  constructor(private readonly classroom: ClassroomService) {}

  @Get('classes/:id/materials') async materials(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { return { materials: await this.classroom.materials(u, id) }; }
  @Post('classes/:id/materials') @Roles('lecturer', 'admin')
  add(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(materialSchema)) dto: MaterialDto) { return this.classroom.addMaterial(u, id, dto); }
  @Delete('materials/:id') @Roles('lecturer', 'admin')
  async remove(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { await this.classroom.removeMaterial(u, id); return { ok: true }; }

  @Get('classes/:id/announcements') async announcements(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { return { announcements: await this.classroom.announcements(u, id) }; }
  @Post('classes/:id/announcements') @Roles('lecturer', 'admin')
  announce(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(announcementSchema)) dto: AnnouncementDto) { return this.classroom.addAnnouncement(u, id, dto); }
  @Delete('announcements/:id') @Roles('lecturer', 'admin')
  async removeAnnouncement(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { await this.classroom.removeAnnouncement(u, id); return { ok: true }; }
}
