import { z } from 'zod';

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const BIDI = /[‪-‮⁦-⁩]/g;

const scrub = (s: string): string => s.normalize('NFC').replace(CONTROL, '').replace(BIDI, '');

/** Multi-line text: control and bidi-override characters removed, then trimmed. */
export const cleanText = (max: number, min = 0) =>
  z
    .string()
    .max(max * 2)
    .transform((s) => scrub(s).trim())
    .pipe(z.string().min(min).max(max));

/** Single-line text (names, titles): whitespace runs collapse to one space. */
export const oneLine = (max: number, min = 1) =>
  z
    .string()
    .max(max * 2)
    .transform((s) => scrub(s).replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(min).max(max));

export const uuid = z.string().uuid();

export const isoDateTime = z.string().datetime({ offset: true });

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254);

const COMMON_PASSWORDS = new Set([
  'password123',
  'password1234',
  '1234567890',
  '12345678910',
  'qwerty12345',
  'qwertyuiop1',
  'letmein1234',
  'welcome1234',
  'iloveyou123',
  'admin12345',
  'changeme123',
  'abc1234567',
]);

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Use at most 128 characters.')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Include at least one letter and one number.')
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), 'That password is too common. Choose something less guessable.')
  .refine((p) => new Set(p).size > 3, 'That password is too repetitive.');

/** Adds "confirmPassword must equal password" to an object schema that has both fields. */
export function withPasswordMatch<S extends z.ZodTypeAny>(schema: S, field = 'password', confirm = 'confirmPassword') {
  return schema.superRefine((value, ctx) => {
    const v = value as Record<string, unknown>;
    if (v[field] !== v[confirm]) {
      ctx.addIssue({ code: 'custom', path: [confirm], message: 'The two passwords do not match.' });
    }
  });
}
