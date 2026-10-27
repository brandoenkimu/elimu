import { z } from 'zod';
import { cleanText, oneLine, uuid } from '../common/zod-helpers';

export const createConversationSchema = z
  .object({
    name: oneLine(80, 2),
    description: cleanText(300).default(''),
  })
  .strict();

export const joinConversationSchema = z
  .object({
    inviteCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/, 'Invite codes look like ABCDE-12345.'),
  })
  .strict();

export const directConversationSchema = z.object({ userId: uuid }).strict();

export type CreateConversationDto = z.infer<typeof createConversationSchema>;
export type JoinConversationDto = z.infer<typeof joinConversationSchema>;
export type DirectConversationDto = z.infer<typeof directConversationSchema>;
