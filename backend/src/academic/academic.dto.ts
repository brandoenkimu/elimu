import { z } from 'zod';
import { cleanText, oneLine, uuid } from '../common/zod-helpers';

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9 \-/]{1,15}$/, 'Use 2 to 16 letters, numbers, spaces or dashes.');

export const courseSchema = z
  .object({
    code,
    name: oneLine(120, 3),
    department: oneLine(100, 0).default(''),
    durationYears: z.number().int().min(1).max(7).default(4),
    semestersPerYear: z.number().int().min(1).max(3).default(2),
    active: z.boolean().default(true),
  })
  .strict();
export const coursePatchSchema = courseSchema.partial().strict();

export const unitSchema = z
  .object({
    courseId: uuid,
    code,
    name: oneLine(140, 3),
    yearOfStudy: z.number().int().min(1).max(7),
    semester: z.number().int().min(1).max(3),
    creditHours: z.number().int().min(1).max(30).default(3),
    description: cleanText(600).default(''),
    active: z.boolean().default(true),
  })
  .strict();
export const unitPatchSchema = unitSchema.partial().strict();

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

export const termSchema = z
  .object({
    name: oneLine(60, 3),
    academicYear: z.string().regex(/^\d{4}\/\d{4}$/, 'Use a format like 2026/2027.'),
    semester: z.number().int().min(1).max(3),
    startsOn: dateOnly.nullable().default(null),
    endsOn: dateOnly.nullable().default(null),
    registrationOpen: z.boolean().default(false),
    evaluationOpen: z.boolean().default(false),
    isCurrent: z.boolean().default(false),
  })
  .strict();
export const termPatchSchema = termSchema.partial().strict();

export const offeringSchema = z
  .object({
    unitId: uuid,
    termId: uuid,
    lecturerId: uuid.nullable().default(null),
    capacity: z.number().int().min(1).max(5000).nullable().default(null),
  })
  .strict();
export const offeringPatchSchema = z
  .object({ lecturerId: uuid.nullable(), capacity: z.number().int().min(1).max(5000).nullable() })
  .partial()
  .strict();

export const registerUnitsSchema = z.object({ offeringIds: z.array(uuid).min(1).max(20) }).strict();

export type CourseDto = z.infer<typeof courseSchema>;
export type UnitDto = z.infer<typeof unitSchema>;
export type TermDto = z.infer<typeof termSchema>;
export type OfferingDto = z.infer<typeof offeringSchema>;
