import { apiFetch } from './client';

export type Priority = 'low' | 'medium' | 'high';

export interface Task {
  id: string;
  _id?: string;
  userId: string;
  title: string;
  description?: string;
  scheduledAt: string;
  deadline: string;
  priority: Priority;
  completed: boolean;
  completedAt: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface TaskListResponse {
  tasks: Task[];
  pagination: TaskPagination;
}

export interface TaskQueryParams {
  status?: 'pending' | 'completed' | 'all';
  priority?: Priority;
  tag?: string;
  search?: string;
  sortBy?: 'createdAt' | 'deadline' | 'priority' | 'urgency';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  scheduledAt: string; // ISO 8601 UTC
  deadline: string; // ISO 8601 UTC
  priority?: Priority;
  tags?: string[];
}

export interface UpdateTaskPayload {
  title?: string;
  description?: string | null;
  scheduledAt?: string;
  deadline?: string;
  priority?: Priority;
  tags?: string[];
}

export const fetchTasks = async (params: TaskQueryParams = {}): Promise<TaskListResponse> => {
  const query = new URLSearchParams();

  if (params.status) query.append('status', params.status);
  if (params.priority) query.append('priority', params.priority);
  if (params.tag) query.append('tag', params.tag);
  if (params.search) query.append('search', params.search);
  if (params.sortBy) query.append('sortBy', params.sortBy);
  if (params.sortOrder) query.append('sortOrder', params.sortOrder);
  query.append('page', String(params.page || 1));
  query.append('limit', String(params.limit || 20));

  return apiFetch<TaskListResponse>(`/api/tasks?${query.toString()}`);
};

export const fetchTaskById = async (id: string): Promise<Task> => {
  const res = await apiFetch<{ task: Task }>(`/api/tasks/${id}`);
  return res.task;
};

export const createTask = async (payload: CreateTaskPayload): Promise<Task> => {
  const res = await apiFetch<{ task: Task }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.task;
};

export const updateTask = async (id: string, payload: UpdateTaskPayload): Promise<Task> => {
  const res = await apiFetch<{ task: Task }>(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return res.task;
};

export const setTaskCompletion = async (id: string, completed: boolean): Promise<Task> => {
  const res = await apiFetch<{ task: Task }>(`/api/tasks/${id}/completion`, {
    method: 'PUT',
    body: JSON.stringify({ completed }),
  });
  return res.task;
};

export const deleteTask = async (id: string): Promise<void> => {
  await apiFetch(`/api/tasks/${id}`, {
    method: 'DELETE',
  });
};
