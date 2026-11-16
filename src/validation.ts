import { z } from 'zod';

export const statusSchema = z.enum(['pendiente', 'en_curso', 'hecha']);
const fields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000),
  status: statusSchema,
  assignee: z.string().trim().min(1).max(100),
  dueDate: z.iso.date(),
};
export const createTaskSchema = z.strictObject({ ...fields, status: statusSchema.default('pendiente') });
export const updateTaskSchema = z.strictObject(fields).partial()
  .refine(value => Object.keys(value).length > 0, 'Envía al menos un campo.');
const positiveInteger = (max: number) => z.string().regex(/^[1-9]\d*$/)
  .transform(Number).pipe(z.number().int().min(1).max(max));
export const idSchema = positiveInteger(Number.MAX_SAFE_INTEGER);
export const querySchema = z.strictObject({
  status: statusSchema.optional(),
  assignee: fields.assignee.optional(),
  page: positiveInteger(1_000_000).default(1),
  limit: positiveInteger(100).default(20),
});
export type TaskInput = z.infer<typeof createTaskSchema>;
export type TaskQuery = z.infer<typeof querySchema>;
export type Task = TaskInput & { id: number; createdAt: string; updatedAt: string };
