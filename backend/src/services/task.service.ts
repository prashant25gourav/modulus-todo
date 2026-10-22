import { Types } from 'mongoose';
import { Task } from '../models/task.model';
import { buildUrgencyAggregationStages } from '../utils/urgency';
import { z } from 'zod';
import {
  createTaskSchema,
  updateTaskSchema,
  taskQuerySchema,
} from '../schemas/task.schema';
import { AppError } from '../utils/errors';

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
 * Atomically updates a task belonging to the specified user using filter-based date inequality
 * and exists-based 400 vs 404 split.
 */
export const updateTask = async (
  userId: Types.ObjectId,
  taskId: string | Types.ObjectId,
  input: UpdateTaskInput
): Promise<Record<string, unknown> | null> => {
  const updatePayload: Record<string, unknown> = { ...input };
  const filter: Record<string, unknown> = { _id: taskId, userId };

  if (input.scheduledAt && input.deadline) {
    const s = new Date(input.scheduledAt);
    const d = new Date(input.deadline);
    if (d.getTime() < s.getTime()) {
      throw new AppError('deadline must be greater than or equal to scheduledAt', 400);
    }
    updatePayload.scheduledAt = s;
    updatePayload.deadline = d;
  } else if (input.deadline) {
    const d = new Date(input.deadline);
    updatePayload.deadline = d;
    // Atomic date check: scheduledAt must be <= new deadline
    filter.scheduledAt = { $lte: d };
  } else if (input.scheduledAt) {
    const s = new Date(input.scheduledAt);
    updatePayload.scheduledAt = s;
    // Atomic date check: deadline must be >= new scheduledAt
    filter.deadline = { $gte: s };
  }

  const updated = await Task.findOneAndUpdate(
    filter,
    { $set: updatePayload },
    { returnDocument: 'after', runValidators: true }
  );

  if (!updated) {
    const exists = await Task.exists({ _id: taskId, userId });
    if (exists) {
      // Document exists but failed atomic inequality check
      throw new AppError('deadline must be greater than or equal to scheduledAt', 400);
    }
    return null;
  }

  return updated.toJSON() as unknown as Record<string, unknown>;
};

/**
 * Idempotent task completion via pipeline update preserving existing completedAt.
 * Uses returnDocument: 'after'.
 */
export const completeTask = async (
  userId: Types.ObjectId,
  taskId: string | Types.ObjectId,
  completed: boolean
): Promise<Record<string, unknown> | null> => {
  const now = new Date();
  const updated = await Task.findOneAndUpdate(
    { _id: taskId, userId },
    [
      {
        $set: {
          completed,
          completedAt: completed
            ? {
                $cond: {
                  if: { $eq: ['$completedAt', null] },
                  then: now,
                  else: '$completedAt',
                },
              }
            : null,
        },
      },
    ],
    { returnDocument: 'after', updatePipeline: true }
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
 * deterministic sorting with _id tie-breaker, and Task.hydrate on aggregation paths.
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

  // 1. Urgency sort aggregation path: sortOrder ignored, always descending with _id tie-breaker
  if (query.sortBy === 'urgency') {
    const [rawTasks, total] = await Promise.all([
      Task.aggregate([
        { $match: filter },
        ...buildUrgencyAggregationStages(now),
        { $skip: skip },
        { $limit: limit },
      ]),
      Task.countDocuments(filter),
    ]);

    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
    const tasks = rawTasks.map((doc) => Task.hydrate(doc).toJSON() as unknown as Record<string, unknown>);

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

  // 2. Priority sort aggregation path with $switch rank (high: 3, medium: 2, low: 1)
  if (query.sortBy === 'priority') {
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;
    const [rawTasks, total] = await Promise.all([
      Task.aggregate([
        { $match: filter },
        {
          $addFields: {
            priorityRank: {
              $switch: {
                branches: [
                  { case: { $eq: ['$priority', 'high'] }, then: 3 },
                  { case: { $eq: ['$priority', 'medium'] }, then: 2 },
                  { case: { $eq: ['$priority', 'low'] }, then: 1 },
                ],
                default: 2,
              },
            },
          },
        },
        {
          $sort: {
            priorityRank: sortDirection,
            _id: sortDirection,
          },
        },
        { $skip: skip },
        { $limit: limit },
      ]),
      Task.countDocuments(filter),
    ]);

    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
    const tasks = rawTasks.map((doc) => Task.hydrate(doc).toJSON() as unknown as Record<string, unknown>);

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

  // 3. Find path for createdAt and deadline (tie-breaker follows sortDirection)
  const sortDirection = query.sortOrder === 'asc' ? 1 : -1;
  const sortField = query.sortBy === 'deadline' ? 'deadline' : 'createdAt';
  const sort: Record<string, 1 | -1> = {
    [sortField]: sortDirection,
    _id: sortDirection,
  };

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
