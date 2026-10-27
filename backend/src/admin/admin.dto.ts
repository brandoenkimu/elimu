import { z } from 'zod';
import { emailSchema, oneLine, uuid } from '../common/zod-helpers';

const displayName = oneLine(80, 2).refine((s) => /^[\p{L}\p{N} .'\-]+$/u.test(s), "Use letters, numbers, spaces and . ' - only.");
const idNumber = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9/\-_.]{2,30}$/, 'Use letters, numbers and / - _ . only (3 to 31 characters).');
const role = z.enum(['student', 'lecturer', 'admin']);

export const createUserSchema = z
  .object({
    role,
    displayName,
    email: emailSchema,
    regNumber: idNumber.optional(),
    staffNumber: idNumber.optional(),
    courseId: uuid.optional(),
    yearOfStudy: z.number().int().min(1).max(7).optional(),
    department: oneLine(100, 0).optional(),
    title: oneLine(24, 0).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.role === 'student' && !v.regNumber) ctx.addIssue({ code: 'custom', path: ['regNumber'], message: 'Students need a registration number.' });
    if (v.role === 'lecturer' && !v.staffNumber) ctx.addIssue({ code: 'custom', path: ['staffNumber'], message: 'Lecturers need a staff number.' });
  });

export const updateUserSchema = z
  .object({
    displayName,
    email: emailSchema,
    role,
    status: z.enum(['active', 'pending', 'suspended']),
    regNumber: idNumber.nullable(),
    staffNumber: idNumber.nullable(),
    courseId: uuid.nullable(),
    yearOfStudy: z.number().int().min(1).max(7).nullable(),
    department: oneLine(100, 0).nullable(),
    title: oneLine(24, 0).nullable(),
  })
  .partial()
  .strict();

export const listUsersSchema = z.object({
  role: role.optional(),
  status: z.enum(['active', 'pending', 'suspended']).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersSchema>;
