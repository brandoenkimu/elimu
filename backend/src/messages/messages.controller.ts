import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AuthUser } from '../common/types';
import { ZodPipe } from '../common/zod.pipe';
import { HistoryQuery, ReactionDto, historyQuerySchema, reactionSchema } from './messages.dto';
import { MessagesService } from './messages.service';

const idPipe = new ParseUUIDPipe();

@Controller('conversations/:conversationId/messages')
@UseGuards(AuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  history(
    @CurrentUser() user: { id: string },
    @Param('conversationId', idPipe) conversationId: string,
    @Query(new ZodPipe(historyQuerySchema)) query: HistoryQuery,
  ) {
    return this.messages.history(user.id, conversationId, query);
  }

  @Delete(':messageId')
  async remove(@CurrentUser() user: AuthUser, @Param('conversationId', idPipe) conversationId: string, @Param('messageId', idPipe) messageId: string) {
    await this.messages.remove(user, conversationId, messageId);
    return { ok: true };
  }

  /** Toggles: reacting twice with the same emoji removes it. */
  @Post(':messageId/reactions')
  @HttpCode(200)
  async react(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', idPipe) conversationId: string,
    @Param('messageId', idPipe) messageId: string,
    @Body(new ZodPipe(reactionSchema)) dto: ReactionDto,
  ) {
    return { reactions: await this.messages.toggleReaction(user, conversationId, messageId, dto.emoji) };
  }
}
