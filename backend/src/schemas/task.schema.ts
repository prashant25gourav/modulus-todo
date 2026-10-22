import { z } from 'zod';

export const createTaskSchema = z
  .object({
    title: z
      .string('Title must be a string')
      .trim()
      .min(1, 'Title cannot be empty')
      .max(120, 'Title cannot exceed 120 characters'),
    description: z
      .string('Description must be a string')
      .trim()
      .max(2000, 'Description cannot exceed 2000 characters')
      .optional(),
    scheduledAt: z
      .string('scheduledAt must be an ISO 8601 UTC date string')
      .datetime({ message: 'scheduledAt must be a valid ISO 8601 UTC date string' }),
    deadline: z
      .string('deadline must be an ISO 8601 UTC date string')
      .datetime({ message: 'deadline must be a valid ISO 8601 UTC date string' }),
    priority: z
      .enum(['low', 'medium', 'high'])
      .default('medium'),
    tags: z
      .array(z.string('Tag must be a string').trim().min(1, 'Tag cannot be empty').max(30, 'Tag cannot exceed 30 characters'))
      .max(10, 'Cannot exceed 10 tags')
      .default([])
      .transform((tags) => Array.from(new Set(tags.map((t) => t.toLowerCase())))),
  })
  .strict()
  .refine(
    (data) => new Date(data.deadline).getTime() >= new Date(data.scheduledAt).getTime(),
    {
      message: 'deadline must be greater than or equal to scheduledAt',
      path: ['deadline'],
    }
  );

export const updateTaskSchema = z
  .object({
    title: z
      .string('Title must be a string')
      .trim()
      .min(1, 'Title cannot be empty')
      .max(120, 'Title cannot exceed 120 characters')
      .optional(),
    description: z
      .string('Description must be a string')
      .trim()
      .max(2000, 'Description cannot exceed 2000 characters')
      .optional(),
    scheduledAt: z
      .string('scheduledAt must be an ISO 8601 UTC date string')
      .datetime({ message: 'scheduledAt must be a valid ISO 8601 UTC date string' })
      .optional(),
    deadline: z
      .string('deadline must be an ISO 8601 UTC date string')
      .datetime({ message: 'deadline must be a valid ISO 8601 UTC date string' })
      .optional(),
    priority: z
      .enum(['low', 'medium', 'high'])
      .optional(),
    tags: z
      .array(z.string('Tag must be a string').trim().min(1, 'Tag cannot be empty').max(30, 'Tag cannot exceed 30 characters'))
      .max(10, 'Cannot exceed 10 tags')
      .optional()
      .transform((tags) => (tags ? Array.from(new Set(tags.map((t) => t.toLowerCase()))) : undefined)),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    {
      message: 'Update payload cannot be empty',
    }
  )
  .refine(
    (data) => {
      if (data.scheduledAt && data.deadline) {
        return new Date(data.deadline).getTime() >= new Date(data.scheduledAt).getTime();
      }
      return true;
    },
    {
      message: 'deadline must be greater than or equal to scheduledAt',
      path: ['deadline'],
    }
  );

export const completeTaskSchema = z
  .object({
    completed: z.boolean({
      error: 'completed must be a boolean',
    }),
  })
  .strict();

export const taskQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['all', 'pending', 'completed']).default('all'),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    tag: z.string().trim().max(30).optional(),
    deadlineFrom: z.string().datetime().optional(),
    deadlineTo: z.string().datetime().optional(),
    search: z.string().trim().max(100).optional(),
    sortBy: z.enum(['createdAt', 'deadline', 'priority', 'urgency']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict()
  .refine(
    (data) => {
      if (data.deadlineFrom && data.deadlineTo) {
        return new Date(data.deadlineFrom).getTime() <= new Date(data.deadlineTo).getTime();
      }
      return true;
    },
    {
      message: 'deadlineFrom must be less than or equal to deadlineTo',
      path: ['deadlineFrom'],
    }
  );
