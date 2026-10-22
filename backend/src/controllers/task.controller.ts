import { Request, Response } from 'express';
import {
  createTask,
  getTaskById,
  updateTask,
  completeTask,
  deleteTask,
  listTasks,
  CreateTaskInput,
  UpdateTaskInput,
  TaskQueryInput,
} from '../services/task.service';
import { AppError, asyncHandler } from '../utils/errors';

/**
 * Create a new task. Success returns 201 { task } without status.
 */
export const createTaskHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const input = res.locals.body as CreateTaskInput;
  const task = await createTask(req.user._id, input);
  res.status(201).json({
    task,
  });
});

/**
 * List tasks for the authenticated user. Success returns 200 { tasks, pagination } without status.
 * Note: req.query is never reassigned.
 */
export const listTasksHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const query = res.locals.query as TaskQueryInput;
  const result = await listTasks(req.user._id, query);
  res.status(200).json(result);
});

/**
 * Get a single task by ID. Success returns 200 { task } without status.
 */
export const getTaskByIdHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const task = await getTaskById(req.user._id, req.params.id as string);
  if (!task) {
    throw new AppError('Task not found', 404);
  }

  res.status(200).json({
    task,
  });
});

/**
 * Atomically update task fields with { _id, userId } scoping. Success returns 200 { task } without status.
 */
export const updateTaskHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const input = res.locals.body as UpdateTaskInput;
  const task = await updateTask(req.user._id, req.params.id as string, input);
  if (!task) {
    throw new AppError('Task not found', 404);
  }

  res.status(200).json({
    task,
  });
});

/**
 * Idempotent task completion via PUT /api/tasks/:id/completion. Success returns 200 { task } without status.
 */
export const completeTaskHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const { completed } = res.locals.body as { completed: boolean };
  const task = await completeTask(req.user._id, req.params.id as string, completed);
  if (!task) {
    throw new AppError('Task not found', 404);
  }

  res.status(200).json({
    task,
  });
});

/**
 * Delete a task scoped to authenticated user. Success returns 204 No Content.
 */
export const deleteTaskHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const deleted = await deleteTask(req.user._id, req.params.id as string);
  if (!deleted) {
    throw new AppError('Task not found', 404);
  }

  res.status(204).send();
});
