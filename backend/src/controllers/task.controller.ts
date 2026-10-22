import { Request, Response } from 'express';
import mongoose from 'mongoose';
import {
  createTask,
  getTaskById,
  updateTask,
  completeTask,
  deleteTask,
  listTasks,
} from '../services/task.service';
import {
  createTaskSchema,
  updateTaskSchema,
  completeTaskSchema,
  taskQuerySchema,
} from '../schemas/task.schema';

/**
 * Create a new task.
 */
export const createTaskHandler = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  const parseResult = createTaskSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  const task = await createTask(req.user._id, parseResult.data);
  res.status(201).json({
    status: 'ok',
    task,
  });
};

/**
 * List tasks for the authenticated user with pagination, filtering, search, and sorting.
 * Note: req.query is never reassigned.
 */
export const listTasksHandler = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  const parseResult = taskQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  const result = await listTasks(req.user._id, parseResult.data);
  res.status(200).json({
    status: 'ok',
    ...result,
  });
};

/**
 * Get a single task by ID. Foreign tasks return 404 to prevent ID probing.
 */
export const getTaskByIdHandler = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  const { id } = req.params;
  if (typeof id !== 'string' || !mongoose.isValidObjectId(id) || id.length !== 24) {
    res.status(400).json({
      status: 'error',
      message: 'Invalid task ID',
    });
    return;
  }

  const task = await getTaskById(req.user._id, id);
  if (!task) {
    res.status(404).json({
      status: 'error',
      message: 'Task not found',
    });
    return;
  }

  res.status(200).json({
    status: 'ok',
    task,
  });
};

/**
 * Atomically update task fields with { _id, userId } scoping.
 * Empty PATCH payloads are rejected by schema.
 */
export const updateTaskHandler = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  const { id } = req.params;
  if (typeof id !== 'string' || !mongoose.isValidObjectId(id) || id.length !== 24) {
    res.status(400).json({
      status: 'error',
      message: 'Invalid task ID',
    });
    return;
  }

  const parseResult = updateTaskSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  try {
    const task = await updateTask(req.user._id, id, parseResult.data);
    if (!task) {
      res.status(404).json({
        status: 'error',
        message: 'Task not found',
      });
      return;
    }

    res.status(200).json({
      status: 'ok',
      task,
    });
  } catch (error: unknown) {
    if ((error as { statusCode?: number }).statusCode === 400) {
      res.status(400).json({
        status: 'error',
        message: (error as Error).message,
      });
      return;
    }
    throw error;
  }
};

/**
 * Idempotent task completion via { completed: boolean } with { _id, userId } scoping.
 */
export const completeTaskHandler = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  const { id } = req.params;
  if (typeof id !== 'string' || !mongoose.isValidObjectId(id) || id.length !== 24) {
    res.status(400).json({
      status: 'error',
      message: 'Invalid task ID',
    });
    return;
  }

  const parseResult = completeTaskSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  const task = await completeTask(req.user._id, id, parseResult.data.completed);
  if (!task) {
    res.status(404).json({
      status: 'error',
      message: 'Task not found',
    });
    return;
  }

  res.status(200).json({
    status: 'ok',
    task,
  });
};

/**
 * Delete a task scoped to authenticated user.
 */
export const deleteTaskHandler = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return;
  }

  const { id } = req.params;
  if (typeof id !== 'string' || !mongoose.isValidObjectId(id) || id.length !== 24) {
    res.status(400).json({
      status: 'error',
      message: 'Invalid task ID',
    });
    return;
  }

  const deleted = await deleteTask(req.user._id, id);
  if (!deleted) {
    res.status(404).json({
      status: 'error',
      message: 'Task not found',
    });
    return;
  }

  res.status(200).json({
    status: 'ok',
    message: 'Task deleted successfully',
  });
};
