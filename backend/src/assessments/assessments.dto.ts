import { z } from 'zod';
import { cleanText, isoDateTime, oneLine, uuid } from '../common/zod-helpers';

const points = z.number().min(0).max(1000).default(1);

export const questionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mcq'),
    prompt: cleanText(2000, 1),
    points,
    options: z.tuple([oneLine(300), oneLine(300), oneLine(300), oneLine(300)]),
    correctKey: z.enum(['A', 'B', 'C', 'D']),
    modelAnswer: cleanText(2000).default(''),
  }).strict(),
  z.object({
    kind: z.literal('text'),
    prompt: cleanText(2000, 1),
    points,
    modelAnswer: cleanText(2000).default(''),
  }).strict(),
]);

const base = z.object({
  kind: z.enum(['assignment', 'exam']),
  title: oneLine(140, 3),
  instructions: cleanText(5000).default(''),
  opensAt: isoDateTime.nullable().default(null),
  dueAt: isoDateTime.nullable().default(null),
  durationMin: z.number().int().min(1).max(600).nullable().default(null),
  maxScore: z.number().gt(0).max(1000).default(100),
  weight: z.number().min(0).max(100).default(0),
  allowFile: z.boolean().default(true),
  allowText: z.boolean().default(true),
  briefFileId: uuid.nullable().default(null),
  autoMark: z.boolean().default(true),
  showAnswers: z.boolean().default(false),
  questions: z.array(questionSchema).max(100).default([]),
}).strict();

const dateOrder = (v: { opensAt: string | null; dueAt: string | null }, ctx: z.RefinementCtx) => {
  if (v.opensAt && v.dueAt && new Date(v.dueAt) <= new Date(v.opensAt)) {
    ctx.addIssue({ code: 'custom', path: ['dueAt'], message: 'The deadline must be after the opening time.' });
  }
};

export const assessmentSchema = base.superRefine(dateOrder);
export const assessmentPatchSchema = base.partial().strict().superRefine((v, ctx) => dateOrder({ opensAt: v.opensAt ?? null, dueAt: v.dueAt ?? null }, ctx));

const answerInput = z.object({
  questionId: uuid,
  choiceKey: z.enum(['A', 'B', 'C', 'D']).nullable().optional(),
  textAnswer: z.string().max(10000).optional(),
}).strict();

export const submissionInputSchema = z.object({
  textAnswer: z.string().max(20000).optional(),
  answers: z.array(answerInput).max(100).optional(),
  fileIds: z.array(uuid).max(5).optional(),
}).strict();

export const gradeSchema = z.object({
  score: z.number().min(0).max(1000).optional(),
  feedback: cleanText(4000).default(''),
  answers: z.array(z.object({ questionId: uuid, score: z.number().min(0).max(1000), feedback: cleanText(2000).default('') }).strict()).max(100).optional(),
}).strict();

export const releaseSchema = z.object({ released: z.boolean(), showAnswers: z.boolean().optional() }).strict();

export type AssessmentDto = z.infer<typeof assessmentSchema>;
export type AssessmentPatchDto = z.infer<typeof assessmentPatchSchema>;
export type QuestionDto = z.infer<typeof questionSchema>;
export type SubmissionInput = z.infer<typeof submissionInputSchema>;
export type GradeDto = z.infer<typeof gradeSchema>;
