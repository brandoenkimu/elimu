import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthUser } from '../common/types';
import {
  CreateConversationDto,
  DirectConversationDto,
  JoinConversationDto,
  createConversationSchema,
  directConversationSchema,
  joinConversationSchema,
} from './conversations.dto';
import { ConversationsService } from './conversations.service';

@Controller('conversations')
@UseGuards(AuthGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return { conversations: await this.conversations.listForUser(user.id) };
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createConversationSchema)) dto: CreateConversationDto) {
    return { conversation: await this.conversations.create(user.id, dto) };
  }

  @Post('join')
  @HttpCode(200)
  async join(@CurrentUser() user: AuthUser, @Body(new ZodPipe(joinConversationSchema)) dto: JoinConversationDto) {
    return { conversation: await this.conversations.join(user.id, dto) };
  }

  @Post('direct')
  @HttpCode(200)
  async direct(@CurrentUser() user: AuthUser, @Body(new ZodPipe(directConversationSchema)) dto: DirectConversationDto) {
    return { conversation: await this.conversations.openDirect(user, dto.userId) };
  }

  @Get(':id/members')
  async members(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return { members: await this.conversations.listMembers(user.id, id) };
  }
}
