import { z } from 'zod';
import { emailSchema, oneLine, passwordSchema, uuid, withPasswordMatch } from '../common/zod-helpers';

const displayName = oneLine(80, 2).refine(
  (s) => /^[\p{L}\p{N} .'\-]+$/u.test(s),
  "Use letters, numbers, spaces and . ' - only.",
);

const confirmPassword = z.string().max(128);

const regNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9/\-_.]{2,30}$/, 'Use letters, numbers and / - _ . only (3 to 31 characters).');

const studentSchema = z
  .object({
    role: z.literal('student'),
    displayName,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword,
    regNumber,
    courseId: uuid.optional(),
    yearOfStudy: z.coerce.number().int().min(1).max(7).optional(),
  })
  .strict();

const lecturerSchema = z
  .object({
    role: z.literal('lecturer'),
    displayName,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword,
    staffNumber: regNumber,
    department: oneLine(100, 2),
    title: oneLine(24, 1).optional(),
  })
  .strict();

export const registerSchema = withPasswordMatch(z.discriminatedUnion('role', [studentSchema, lecturerSchema]));

export const loginSchema = z
  .object({
    email: emailSchema,
    // Length only: never apply the registration rules here, or older passwords lock people out.
    password: z.string().min(1).max(128),
    remember: z.boolean().default(true),
  })
  .strict();

export const forgotSchema = z.object({ email: emailSchema }).strict();

export const resetSchema = withPasswordMatch(
  z
    .object({
      token: z.string().min(20).max(200),
      password: passwordSchema,
      confirmPassword,
    })
    .strict(),
);

export const changePasswordSchema = withPasswordMatch(
  z
    .object({
      currentPassword: z.string().min(1).max(128),
      newPassword: passwordSchema,
      confirmPassword,
    })
    .strict(),
  'newPassword',
);

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type ForgotDto = z.infer<typeof forgotSchema>;
export type ResetDto = z.infer<typeof resetSchema>;
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
