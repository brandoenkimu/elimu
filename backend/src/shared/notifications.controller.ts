import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthUser } from '../common/types';
import { uuid } from '../common/zod-helpers';
import { NotificationsService } from './notifications.service';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  before: z.string().datetime({ offset: true }).optional(),
});

const readBody = z
  .object({ ids: z.array(uuid).max(100).optional(), all: z.boolean().optional() })
  .strict()
  .refine((b) => b.all === true || (b.ids && b.ids.length > 0), { message: 'Choose which notifications to mark as read.' });

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.notifications.list(user.id, q.limit, q.before);
  }

  @Post('read')
  @HttpCode(200)
  async read(@CurrentUser() user: AuthUser, @Body(new ZodPipe(readBody)) body: z.infer<typeof readBody>) {
    const changed = await this.notifications.markRead(user.id, body.all ? null : (body.ids ?? []));
    return { changed, unread: await this.notifications.unreadCount(user.id) };
  }
}
