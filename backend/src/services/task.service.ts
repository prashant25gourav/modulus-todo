import { Types, PipelineStage } from 'mongoose';
import { Task } from '../models/task.model';
import { buildUrgencyAggregationStages } from '../utils/urgency';
import { z } from 'zod';
import {
  createTaskSchema,
  updateTaskSchema,
  taskQuerySchema,
} from '../schemas/task.schema';

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskQueryInput = z.infer<typeof taskQuerySchema>;

export interface PaginatedTasksResult {
  tasks: Record<string, unknown>[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

/**
 * Creates a new task belonging to the specified user.
 */
export const createTask = async (
  userId: Types.ObjectId,
  input: CreateTaskInput
): Promise<Record<string, unknown>> => {
  const task = new Task({
    userId,
    title: input.title,
    description: input.description,
    scheduledAt: new Date(input.scheduledAt),
    deadline: new Date(input.deadline),
    priority: input.priority,
    tags: input.tags,
    completed: false,
    completedAt: null,
  });

  await task.save();
  return task.toJSON() as unknown as Record<string, unknown>;
};

/**
 * Retrieves a single task by ID scoped to the authenticated user.
 */
export const getTaskById = async (
  userId: Types.ObjectId,
  taskId: string | Types.ObjectId
): Promise<Record<string, unknown> | null> => {
  const task = await Task.findOne({ _id: taskId, userId });
  return task ? (task.toJSON() as unknown as Record<string, unknown>) : null;
};

/**
 * Atomically updates a task belonging to the specified user.
 * Rejects updates where deadline would precede scheduledAt.
 */
export const updateTask = async (
  userId: Types.ObjectId,
  taskId: string | Types.ObjectId,
  input: UpdateTaskInput
): Promise<Record<string, unknown> | null> => {
  if (input.scheduledAt || input.deadline) {
    const existing = await Task.findOne({ _id: taskId, userId });
    if (!existing) {
      return null;
    }
    const targetScheduledAt = input.scheduledAt
      ? new Date(input.scheduledAt)
      : existing.scheduledAt;
    const targetDeadline = input.deadline
      ? new Date(input.deadline)
      : existing.deadline;

    if (targetDeadline.getTime() < targetScheduledAt.getTime()) {
      const err = new Error('deadline must be greater than or equal to scheduledAt');
      (err as { statusCode?: number }).statusCode = 400;
      throw err;
    }
  }

  const updatePayload: Record<string, unknown> = { ...input };
  if (input.scheduledAt) updatePayload.scheduledAt = new Date(input.scheduledAt);
  if (input.deadline) updatePayload.deadline = new Date(input.deadline);

  const updated = await Task.findOneAndUpdate(
    { _id: taskId, userId },
    { $set: updatePayload },
    { new: true, runValidators: true }
  );

  return updated ? (updated.toJSON() as unknown as Record<string, unknown>) : null;
};

/**
 * Atomically marks a task complete or incomplete. Idempotent.
 */
export const completeTask = async (
  userId: Types.ObjectId,
  taskId: string | Types.ObjectId,
  completed: boolean
): Promise<Record<string, unknown> | null> => {
  const completedAt = completed ? new Date() : null;
  const updated = await Task.findOneAndUpdate(
    { _id: taskId, userId },
    { $set: { completed, completedAt } },
    { new: true, runValidators: true }
  );

  return updated ? (updated.toJSON() as unknown as Record<string, unknown>) : null;
};

/**
 * Atomically deletes a task belonging to the specified user.
 */
export const deleteTask = async (
  userId: Types.ObjectId,
  taskId: string | Types.ObjectId
): Promise<boolean> => {
  const result = await Task.findOneAndDelete({ _id: taskId, userId });
  return result !== null;
};

/**
 * Lists tasks for a user with pagination, filtering, escaped capped regex search,
 * and deterministic sorting with _id tie-breaker.
 * Accepts optional 'now' injection for urgency score parity testing.
 */
export const listTasks = async (
  userId: Types.ObjectId,
  query: TaskQueryInput,
  now: Date = new Date()
): Promise<PaginatedTasksResult> => {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const skip = (page - 1) * limit;

  // Build match filter scoped strictly to user
  const filter: Record<string, unknown> = { userId };

  // Status filter
  if (query.status === 'pending') {
    filter.completed = false;
  } else if (query.status === 'completed') {
    filter.completed = true;
  }

  // Priority filter
  if (query.priority) {
    filter.priority = query.priority;
  }

  // Tag filter (case-insensitive normalized lowercase)
  if (query.tag && query.tag.trim().length > 0) {
    filter.tags = query.tag.trim().toLowerCase();
  }

  // Deadline range filters
  if (query.deadlineFrom || query.deadlineTo) {
    const deadlineFilter: Record<string, unknown> = {};
    if (query.deadlineFrom) deadlineFilter.$gte = new Date(query.deadlineFrom);
    if (query.deadlineTo) deadlineFilter.$lte = new Date(query.deadlineTo);
    filter.deadline = deadlineFilter;
  }

  // Escaped capped regex search on title and description
  if (query.search && query.search.trim().length > 0) {
    const cappedSearch = query.search.trim().slice(0, 100);
    const escapedSearch = cappedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { title: { $regex: escapedSearch, $options: 'i' } },
      { description: { $regex: escapedSearch, $options: 'i' } },
    ];
  }

  // Urgency sort pipeline: sortOrder is ignored, always descending urgencyScore with _id tie-breaker
  if (query.sortBy === 'urgency') {
    const urgencyPipeline: PipelineStage[] = [
      { $match: filter },
      ...buildUrgencyAggregationStages(now),
      {
        $facet: {
          tasks: [
            { $skip: skip },
            { $limit: limit },
          ],
          totalCount: [
            { $count: 'count' },
          ],
        },
      },
    ];

    const [aggResult] = await Task.aggregate(urgencyPipeline);
    const rawTasks: Record<string, unknown>[] = aggResult?.tasks || [];
    const total: number = aggResult?.totalCount?.[0]?.count || 0;
    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

    const tasks = rawTasks.map((doc) => new Task(doc).toJSON() as unknown as Record<string, unknown>);

    return {
      tasks,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  // Standard query sorting with deterministic _id tie-breaker
  const sortDirection = query.sortOrder === 'asc' ? 1 : -1;
  let sort: Record<string, 1 | -1>;

  if (query.sortBy === 'deadline') {
    sort = { deadline: sortDirection, _id: -1 };
  } else if (query.sortBy === 'priority') {
    sort = { priority: sortDirection, _id: -1 };
  } else {
    // Default: createdAt
    sort = { createdAt: sortDirection, _id: -1 };
  }

  const [docs, total] = await Promise.all([
    Task.find(filter).sort(sort).skip(skip).limit(limit),
    Task.countDocuments(filter),
  ]);

  const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
  const tasks = docs.map((doc) => doc.toJSON() as unknown as Record<string, unknown>);

  return {
    tasks,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages,
    },
  };
};
