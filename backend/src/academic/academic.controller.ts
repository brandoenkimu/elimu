import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../common/roles';
import type { AuthUser } from '../common/types';
import { ZodPipe } from '../common/zod.pipe';
import { ConversationsService } from '../conversations/conversations.service';
import { z } from 'zod';
import {
  CourseDto, OfferingDto, TermDto, UnitDto,
  coursePatchSchema, courseSchema, offeringPatchSchema, offeringSchema, registerUnitsSchema,
  termPatchSchema, termSchema, unitPatchSchema, unitSchema,
} from './academic.dto';
import { CatalogService } from './catalog.service';
import { EnrolmentService } from './enrolment.service';

const idPipe = new ParseUUIDPipe();
const studentIdSchema = z.object({ studentId: z.string().uuid() }).strict();

/** Open to anyone: the sign-up page needs the course list before an account exists. */
@Controller('catalog')
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('courses')
  async courses() {
    return { courses: await this.catalog.publicCourses() };
  }
}

@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminAcademicController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly enrolment: EnrolmentService,
  ) {}

  @Get('courses') async courses() { return { courses: await this.catalog.listCourses() }; }
  @Post('courses') create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(courseSchema)) dto: CourseDto) { return this.catalog.createCourse(u, dto); }
  @Patch('courses/:id') async updateCourse(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(coursePatchSchema)) dto: Record<string, unknown>) { await this.catalog.updateCourse(u, id, dto); return { ok: true }; }
  @Delete('courses/:id') async deleteCourse(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { await this.catalog.deleteCourse(u, id); return { ok: true }; }

  @Get('units') async units(@Query('courseId') courseId?: string) { return { units: await this.catalog.listUnits(courseId && /^[0-9a-f-]{36}$/i.test(courseId) ? courseId : undefined) }; }
  @Post('units') createUnit(@CurrentUser() u: AuthUser, @Body(new ZodPipe(unitSchema)) dto: UnitDto) { return this.catalog.createUnit(u, dto); }
  @Patch('units/:id') async updateUnit(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(unitPatchSchema)) dto: Record<string, unknown>) { await this.catalog.updateUnit(u, id, dto); return { ok: true }; }
  @Delete('units/:id') async deleteUnit(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { await this.catalog.deleteUnit(u, id); return { ok: true }; }

  @Get('terms') async terms() { return { terms: await this.catalog.listTerms() }; }
  @Post('terms') createTerm(@CurrentUser() u: AuthUser, @Body(new ZodPipe(termSchema)) dto: TermDto) { return this.catalog.createTerm(u, dto); }
  @Patch('terms/:id') async updateTerm(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(termPatchSchema)) dto: Record<string, unknown>) { await this.catalog.updateTerm(u, id, dto); return { ok: true }; }

  @Get('offerings')
  async offerings(@Query('termId') termId?: string, @Query('courseId') courseId?: string) {
    const ok = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
    return { offerings: await this.catalog.listOfferings(ok(termId), ok(courseId)) };
  }
  @Post('offerings') createOffering(@CurrentUser() u: AuthUser, @Body(new ZodPipe(offeringSchema)) dto: OfferingDto) { return this.catalog.createOffering(u, dto); }
  @Patch('offerings/:id') async updateOffering(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(offeringPatchSchema)) dto: Record<string, unknown>) { await this.catalog.updateOffering(u, id, dto); return { ok: true }; }
  @Delete('offerings/:id') async deleteOffering(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { await this.catalog.deleteOffering(u, id); return { ok: true }; }

  @Post('offerings/:id/students') @HttpCode(200)
  async enrol(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(studentIdSchema)) dto: { studentId: string }) { await this.enrolment.adminEnrol(u, id, dto.studentId); return { ok: true }; }
  @Delete('offerings/:id/students/:studentId')
  async unenrol(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Param('studentId', idPipe) studentId: string) { await this.enrolment.adminUnenrol(u, id, studentId); return { ok: true }; }
}

@Controller()
@UseGuards(AuthGuard, RolesGuard)
export class ClassesController {
  constructor(
    private readonly enrolment: EnrolmentService,
    private readonly catalog: CatalogService,
    private readonly conversations: ConversationsService,
  ) {}

  @Get('classes')
  async mine(@CurrentUser() u: AuthUser) {
    return { classes: await this.enrolment.mine(u), term: await this.catalog.currentTerm() };
  }

  @Get('classes/:id')
  async one(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) {
    return { class: await this.enrolment.detail(u, id) };
  }

  @Get('classes/:id/roster') @Roles('lecturer', 'admin')
  async roster(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) {
    return { students: await this.enrolment.roster(u, id) };
  }

  @Get('classes/:id/roster.csv') @Roles('lecturer', 'admin')
  async rosterCsv(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Res() res: Response) {
    const { filename, csv } = await this.enrolment.rosterCsv(u, id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }

  @Post('classes/:id/chat') @HttpCode(200) @Roles('lecturer', 'admin')
  async classChat(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) {
    return { conversation: await this.conversations.createClassGroup(u, id) };
  }

  @Get('registration') @Roles('student')
  registration(@CurrentUser() u: AuthUser) { return this.enrolment.registrationOverview(u); }

  @Post('registration') @HttpCode(200) @Roles('student')
  register(@CurrentUser() u: AuthUser, @Body(new ZodPipe(registerUnitsSchema)) dto: { offeringIds: string[] }) { return this.enrolment.register(u, dto.offeringIds); }

  @Delete('registration/:offeringId') @Roles('student')
  async drop(@CurrentUser() u: AuthUser, @Param('offeringId', idPipe) id: string) { await this.enrolment.drop(u, id); return { ok: true }; }
}
