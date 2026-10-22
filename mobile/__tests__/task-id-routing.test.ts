import { useTasksStore } from '../src/store/tasks';
import { updateTask } from '../src/api/tasks';

describe('Task ID API Routing & Store Integration', () => {
  const realisticTaskId = '6717a6000000000000000001';
  const realisticApiResponse = {
    tasks: [
      {
        id: realisticTaskId,
        userId: '6717a6000000000000000099',
        title: 'Realistic Backend Task',
        description: 'Returned with id field from MongoDB toJSON transform',
        scheduledAt: '2026-10-22T10:00:00.000Z',
        deadline: '2026-10-22T18:00:00.000Z',
        priority: 'medium',
        completed: false,
        completedAt: null,
        tags: ['test'],
        createdAt: '2026-10-22T08:00:00.000Z',
        updatedAt: '2026-10-22T08:00:00.000Z',
      },
    ],
    pagination: {
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    },
  };

  let capturedUrls: string[] = [];

  beforeEach(() => {
    capturedUrls = [];
    jest.clearAllMocks();

    (globalThis as any).fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrls.push(url);
      const method = init?.method || 'GET';

      if (url.includes('/api/tasks?')) {
        return {
          ok: true,
          status: 200,
          json: async () => realisticApiResponse,
        };
      }

      if (url.includes('/completion')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            task: {
              ...realisticApiResponse.tasks[0],
              completed: true,
              completedAt: new Date().toISOString(),
            },
          }),
        };
      }

      if (method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            task: {
              ...realisticApiResponse.tasks[0],
              title: 'Updated Title',
            },
          }),
        };
      }

      if (method === 'DELETE') {
        return {
          ok: true,
          status: 204,
          json: async () => null,
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    }) as jest.Mock;
  });

  it('correctly uses task id (not undefined) for update, completion, and delete', async () => {
    // 1. Load tasks through store from realistic response (which contains .id and NOT ._id)
    await useTasksStore.getState().loadTasks();
    const task = useTasksStore.getState().tasks[0] as any;

    expect(task).toBeDefined();

    // In the old code, task._id was used by screens and store:
    // task._id is undefined on realistic API data!
    // With the fix, task.id is defined and used.
    const targetId = task.id || task._id;

    // 2. Perform update
    await updateTask(targetId, { title: 'Updated Title' });
    expect(capturedUrls).toContainEqual(
      expect.stringContaining('/api/tasks/' + realisticTaskId)
    );
    expect(capturedUrls).not.toContainEqual(
      expect.stringContaining('/api/tasks/undefined')
    );

    // 3. Perform toggleCompletion through store
    await useTasksStore.getState().toggleCompletion(targetId);
    expect(capturedUrls).toContainEqual(
      expect.stringContaining('/api/tasks/' + realisticTaskId + '/completion')
    );
    expect(capturedUrls).not.toContainEqual(
      expect.stringContaining('/api/tasks/undefined/completion')
    );

    // 4. Perform delete through store
    await useTasksStore.getState().deleteTask(targetId);
    expect(capturedUrls).toContainEqual(
      expect.stringMatching(new RegExp('/api/tasks/' + realisticTaskId + '$'))
    );
    expect(capturedUrls).not.toContainEqual(
      expect.stringMatching(/\/api\/tasks\/undefined$/)
    );
  });
});
