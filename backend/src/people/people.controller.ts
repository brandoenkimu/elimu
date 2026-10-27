import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthUser } from '../common/types';
import { cleanText, uuid } from '../common/zod-helpers';
import { ConnectionsService } from './connections.service';
import {
  PeopleService,
  PreferencesDto,
  UpdateProfileDto,
  preferencesSchema,
  searchSchema,
  updateProfileSchema,
} from './people.service';

const requestSchema = z.object({ userId: uuid, note: cleanText(200).default('') }).strict();

@Controller('profile')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly people: PeopleService) {}

  @Put()
  async update(@CurrentUser() user: AuthUser, @Body(new ZodPipe(updateProfileSchema)) dto: UpdateProfileDto) {
    return { user: await this.people.updateProfile(user, dto) };
  }

  @Put('preferences')
  async preferences(@CurrentUser() user: AuthUser, @Body(new ZodPipe(preferencesSchema)) dto: PreferencesDto) {
    return { preferences: await this.people.updatePreferences(user, dto) };
  }
}

@Controller('people')
@UseGuards(AuthGuard)
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query(new ZodPipe(searchSchema)) q: z.infer<typeof searchSchema>) {
    return this.people.search(user, q.q, q.role);
  }

  @Get('suggestions')
  suggestions(@CurrentUser() user: AuthUser) {
    return this.people.suggestions(user);
  }

  @Get(':id')
  profile(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.people.publicProfile(user, id).then((profile) => ({ profile }));
  }
}

@Controller('connections')
@UseGuards(AuthGuard)
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.connections.list(user);
  }

  @Post()
  send(@CurrentUser() user: AuthUser, @Body(new ZodPipe(requestSchema)) body: z.infer<typeof requestSchema>) {
    return this.connections.send(user, body.userId, body.note);
  }

  @Post(':id/accept')
  @HttpCode(200)
  async accept(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.connections.respond(user, id, true);
    return { ok: true };
  }

  @Post(':id/decline')
  @HttpCode(200)
  async decline(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.connections.respond(user, id, false);
    return { ok: true };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.connections.remove(user, id);
  }

  @Post('block/:userId')
  @HttpCode(200)
  async block(@CurrentUser() user: AuthUser, @Param('userId', new ParseUUIDPipe()) userId: string) {
    await this.connections.block(user, userId);
    return { ok: true };
  }

  @Delete('block/:userId')
  @HttpCode(204)
  async unblock(@CurrentUser() user: AuthUser, @Param('userId', new ParseUUIDPipe()) userId: string): Promise<void> {
    await this.connections.unblock(user, userId);
  }
}
