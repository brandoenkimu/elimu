import { z } from 'zod';

export const MAX_MESSAGE_LENGTH = 2000;

/** Used for messages arriving over the WebSocket. */
export const sendMessageSchema = z
  .object({
    conversationId: z.string().uuid(),
    clientMessageId: z.string().uuid(),
    replyToId: z.string().uuid().optional(),
    body: z
      .string()
      .max(MAX_MESSAGE_LENGTH * 2) // cheap pre-check before normalising
      .transform((s) =>
        s
          .normalize('NFC')
          // Remove control characters but keep tab and newline.
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
          // Remove bidi override characters that can visually spoof text.
          .replace(/[‪-‮⁦-⁩]/g, '')
          .trim(),
      )
      .pipe(z.string().min(1).max(MAX_MESSAGE_LENGTH)),
  })
  .strict();

export type SendMessageDto = z.infer<typeof sendMessageSchema>;

/** Query string for GET /conversations/:id/messages. */
export const historyQuerySchema = z
  .object({
    before: z.coerce.number().int().positive().optional(),
    after: z.coerce.number().int().nonnegative().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((q) => q.before === undefined || q.after === undefined, {
    message: 'Use either "before" or "after", not both.',
  });

export type HistoryQuery = z.infer<typeof historyQuerySchema>;

/** One emoji: a single grapheme made of emoji characters (flags, skin tones and family sequences included). */
const EMOJI_PART = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3/u;
export const reactionSchema = z
  .object({
    emoji: z
      .string()
      .min(1)
      .max(40)
      .refine((s) => {
        const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
        const parts = [...seg.segment(s)];
        return parts.length === 1 && EMOJI_PART.test(s);
      }, 'Pick a single emoji.'),
  })
  .strict();
export type ReactionDto = z.infer<typeof reactionSchema>;
