import { create } from 'zustand';
import {
  Task,
  TaskPagination,
  fetchTasks,
  setTaskCompletion,
  deleteTask as deleteTaskApi,
  createTask as createTaskApi,
  updateTask as updateTaskApi,
  CreateTaskPayload,
  UpdateTaskPayload,
} from '../api/tasks';
import { ApiError } from '../api/client';

export type StatusFilter = 'all' | 'pending' | 'completed';
export type SortOption = 'urgency' | 'deadline' | 'priority' | 'createdAt';

interface TasksState {
  tasks: Task[];
  pagination: TaskPagination;
  statusFilter: StatusFilter;
  sortBy: SortOption;
  searchQuery: string;

  isLoading: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  isWakingServer: boolean;
  error: string | null;

  setStatusFilter: (filter: StatusFilter) => void;
  setSortBy: (sort: SortOption) => void;
  setSearchQuery: (query: string) => void;

  loadTasks: (isRefresh?: boolean) => Promise<void>;
  loadMoreTasks: () => Promise<void>;
  toggleCompletion: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  createTask: (payload: CreateTaskPayload) => Promise<Task>;
  updateTask: (id: string, payload: UpdateTaskPayload) => Promise<Task>;
  clearError: () => void;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  pagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  },
  statusFilter: 'all',
  sortBy: 'urgency',
  searchQuery: '',

  isLoading: false,
  isRefreshing: false,
  isLoadingMore: false,
  isWakingServer: false,
  error: null,

  clearError: () => set({ error: null }),

  setStatusFilter: (filter: StatusFilter) => {
    set({ statusFilter: filter });
    get().loadTasks();
  },

  setSortBy: (sort: SortOption) => {
    set({ sortBy: sort });
    get().loadTasks();
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
    get().loadTasks();
  },

  loadTasks: async (isRefresh: boolean = false) => {
    const { statusFilter, sortBy, searchQuery, isRefreshing } = get();

    if (isRefresh) {
      if (isRefreshing) return;
      set({ isRefreshing: true, error: null });
    } else {
      set({ isLoading: true, error: null, isWakingServer: false });
    }

    // 5-second server cold start detection timer
    const wakeTimer = setTimeout(() => {
      if (get().isLoading) {
        set({ isWakingServer: true });
      }
    }, 5000);

    try {
      const response = await fetchTasks({
        status: statusFilter,
        sortBy,
        sortOrder: 'desc',
        search: searchQuery.trim() || undefined,
        page: 1,
        limit: 20,
      });

      set({
        tasks: response.tasks,
        pagination: response.pagination,
        isLoading: false,
        isRefreshing: false,
        isWakingServer: false,
        error: null,
      });
    } catch (err: unknown) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to load tasks. Please try again.';
      set({
        error: message,
        isLoading: false,
        isRefreshing: false,
        isWakingServer: false,
      });
    } finally {
      clearTimeout(wakeTimer);
    }
  },

  loadMoreTasks: async () => {
    const { pagination, isLoadingMore, isLoading, isRefreshing, statusFilter, sortBy, searchQuery, tasks } = get();

    if (isLoadingMore || isLoading || isRefreshing || pagination.page >= pagination.totalPages) {
      return;
    }

    set({ isLoadingMore: true });

    try {
      const nextPage = pagination.page + 1;
      const response = await fetchTasks({
        status: statusFilter,
        sortBy,
        sortOrder: 'desc',
        search: searchQuery.trim() || undefined,
        page: nextPage,
        limit: 20,
      });

      set({
        tasks: [...tasks, ...response.tasks],
        pagination: response.pagination,
        isLoadingMore: false,
      });
    } catch {
      set({ isLoadingMore: false });
    }
  },

  toggleCompletion: async (id: string) => {
    const { tasks } = get();
    const taskIndex = tasks.findIndex((t) => t._id === id);
    if (taskIndex === -1) return;

    const previousTask = tasks[taskIndex];
    const newCompleted = !previousTask.completed;

    // Optimistic Update
    const optimisticTasks = [...tasks];
    optimisticTasks[taskIndex] = {
      ...previousTask,
      completed: newCompleted,
      completedAt: newCompleted ? new Date().toISOString() : null,
    };
    set({ tasks: optimisticTasks });

    try {
      const updated = await setTaskCompletion(id, newCompleted);
      // Synchronize with server response
      const syncedTasks = [...get().tasks];
      const currentIndex = syncedTasks.findIndex((t) => t._id === id);
      if (currentIndex !== -1) {
        syncedTasks[currentIndex] = updated;
        set({ tasks: syncedTasks });
      }
    } catch {
      // Rollback on failure
      const rolledBackTasks = [...get().tasks];
      const currentIndex = rolledBackTasks.findIndex((t) => t._id === id);
      if (currentIndex !== -1) {
        rolledBackTasks[currentIndex] = previousTask;
        set({
          tasks: rolledBackTasks,
          error: 'Failed to update task completion. Changes rolled back.',
        });
      }
    }
  },

  deleteTask: async (id: string) => {
    const { tasks, pagination } = get();
    const previousTasks = [...tasks];

    // Optimistically remove from list
    set({
      tasks: tasks.filter((t) => t._id !== id),
      pagination: {
        ...pagination,
        total: Math.max(0, pagination.total - 1),
      },
    });

    try {
      await deleteTaskApi(id);
    } catch {
      // Rollback
      set({
        tasks: previousTasks,
        pagination,
        error: 'Failed to delete task. Changes rolled back.',
      });
    }
  },

  createTask: async (payload: CreateTaskPayload) => {
    const created = await createTaskApi(payload);
    await get().loadTasks(true);
    return created;
  },

  updateTask: async (id: string, payload: UpdateTaskPayload) => {
    const updated = await updateTaskApi(id, payload);
    await get().loadTasks(true);
    return updated;
  },
}));
