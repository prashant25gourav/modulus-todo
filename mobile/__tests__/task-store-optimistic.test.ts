import { useTasksStore } from '../src/store/tasks';
import * as tasksApi from '../src/api/tasks';

describe('Tasks Store Optimistic Completion & Rollback', () => {
  const initialTask: tasksApi.Task = {
    _id: 'task-test-123',
    userId: 'user-456',
    title: 'Optimistic Test Task',
    scheduledAt: '2026-10-22T10:00:00.000Z',
    deadline: '2026-10-22T18:00:00.000Z',
    priority: 'high',
    completed: false,
    completedAt: null,
    tags: ['test'],
    createdAt: '2026-10-22T08:00:00.000Z',
    updatedAt: '2026-10-22T08:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useTasksStore.setState({
      tasks: [initialTask],
      error: null,
    });
  });

  it('rolls back task completion when the backend API fails', async () => {
    // Mock setTaskCompletion to reject with a network/server failure
    jest.spyOn(tasksApi, 'setTaskCompletion').mockRejectedValueOnce(
      new Error('500 Internal Server Error')
    );

    // Initial state: incomplete
    expect(useTasksStore.getState().tasks[0].completed).toBe(false);

    // Trigger toggleCompletion
    await useTasksStore.getState().toggleCompletion('task-test-123');

    // After failure, task must be rolled back to initial state (completed: false)
    const taskAfterFailure = useTasksStore.getState().tasks[0];
    expect(taskAfterFailure.completed).toBe(false);
    expect(taskAfterFailure.completedAt).toBeNull();

    // Error message must indicate rollback occurred
    expect(useTasksStore.getState().error).toContain('Changes rolled back');
  });

  it('successfully commits completion when the backend API succeeds', async () => {
    const completedServerTask: tasksApi.Task = {
      ...initialTask,
      completed: true,
      completedAt: '2026-10-22T12:00:00.000Z',
      updatedAt: '2026-10-22T12:00:00.000Z',
    };

    jest.spyOn(tasksApi, 'setTaskCompletion').mockResolvedValueOnce(completedServerTask);

    await useTasksStore.getState().toggleCompletion('task-test-123');

    const taskAfterSuccess = useTasksStore.getState().tasks[0];
    expect(taskAfterSuccess.completed).toBe(true);
    expect(taskAfterSuccess.completedAt).toBe('2026-10-22T12:00:00.000Z');
    expect(useTasksStore.getState().error).toBeNull();
  });
});
