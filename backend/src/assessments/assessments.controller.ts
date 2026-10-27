import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../common/roles';
import type { AuthUser } from '../common/types';
import { ZodPipe } from '../common/zod.pipe';
import {
  AssessmentDto, AssessmentPatchDto, GradeDto, SubmissionInput,
  assessmentPatchSchema, assessmentSchema, gradeSchema, releaseSchema, submissionInputSchema,
} from './assessments.dto';
import { AssessmentsService } from './assessments.service';
import { GradingService } from './grading.service';

const idPipe = new ParseUUIDPipe();
const staff = ['lecturer', 'admin'] as const;

@Controller()
@UseGuards(AuthGuard, RolesGuard)
export class AssessmentsController {
  constructor(
    private readonly assessments: AssessmentsService,
    private readonly grading: GradingService,
  ) {}

  @Get('classes/:id/assessments')
  async list(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { return { assessments: await this.assessments.list(u, id) }; }

  @Post('classes/:id/assessments') @Roles(...staff)
  create(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(assessmentSchema)) dto: AssessmentDto) { return this.assessments.create(u, id, dto); }

  @Get('assessments/:id')
  async view(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { return { assessment: await this.assessments.view(u, id) }; }

  @Patch('assessments/:id') @Roles(...staff)
  async update(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(assessmentPatchSchema)) dto: AssessmentPatchDto) { await this.assessments.update(u, id, dto); return { ok: true }; }

  @Post('assessments/:id/publish') @HttpCode(200) @Roles(...staff)
  async publish(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { await this.assessments.setStatus(u, id, 'published'); return { ok: true }; }
  @Post('assessments/:id/close') @HttpCode(200) @Roles(...staff)
  async close(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { await this.assessments.setStatus(u, id, 'closed'); return { ok: true }; }
  @Post('assessments/:id/unpublish') @HttpCode(200) @Roles(...staff)
  async unpublish(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { await this.assessments.setStatus(u, id, 'draft'); return { ok: true }; }
  @Delete('assessments/:id') @Roles(...staff)
  async remove(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { await this.assessments.remove(u, id); return { ok: true }; }

  @Post('assessments/:id/auto-mark') @HttpCode(200) @Roles(...staff)
  autoMark(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { return this.assessments.autoMark(u, id); }
  @Post('assessments/:id/release') @HttpCode(200) @Roles(...staff)
  release(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(releaseSchema)) dto: { released: boolean; showAnswers?: boolean }) { return this.grading.release(u, id, dto.released, dto.showAnswers); }

  // student work
  @Post('assessments/:id/start') @HttpCode(200) @Roles('student')
  async start(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { return { assessment: await this.assessments.start(u, id) }; }
  @Put('assessments/:id/submission') @Roles('student')
  async save(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(submissionInputSchema)) dto: SubmissionInput) { return { assessment: await this.assessments.save(u, id, dto, false) }; }
  @Post('assessments/:id/submit') @HttpCode(200) @Roles('student')
  async submit(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(submissionInputSchema)) dto: SubmissionInput) { return { assessment: await this.assessments.save(u, id, dto, true) }; }

  // marking
  @Get('assessments/:id/submissions') @Roles(...staff)
  submissions(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { return this.grading.submissions(u, id); }
  @Get('submissions/:id') @Roles(...staff)
  async submission(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { return { submission: await this.grading.submission(u, id) }; }
  @Put('submissions/:id/grade') @Roles(...staff)
  grade(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(gradeSchema)) dto: GradeDto) { return this.grading.grade(u, id, dto); }

  // gradebook
  @Get('classes/:id/gradebook') @Roles(...staff)
  gradebook(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { return this.grading.gradebook(u, id); }
  @Get('classes/:id/gradebook.csv') @Roles(...staff)
  async gradebookCsv(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Res() res: Response) {
    const csv = await this.grading.gradebookCsv(u, id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="gradebook.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }
  @Get('classes/:id/my-grades') @Roles('student')
  myGrades(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { return this.grading.myGrades(u, id); }
}
