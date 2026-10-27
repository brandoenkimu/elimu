import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../common/roles';
import type { AuthUser } from '../common/types';
import { ZodPipe } from '../common/zod.pipe';
import { EvaluationsService, evaluationSchema } from './evaluations.service';

const idPipe = new ParseUUIDPipe();

@Controller('classes/:id/evaluation')
@UseGuards(AuthGuard, RolesGuard)
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Get() @Roles('student')
  status(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { return this.evaluations.status(u, id); }

  @Post() @HttpCode(200) @Roles('student')
  async submit(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string, @Body(new ZodPipe(evaluationSchema)) dto: z.infer<typeof evaluationSchema>) {
    await this.evaluations.submit(u, id, dto);
    return { ok: true };
  }

  @Get('results') @Roles('lecturer', 'admin')
  results(@CurrentUser() u: AuthUser, @Param('id', idPipe) id: string) { return this.evaluations.results(u, id); }
}
