import { apiFetch } from '../src/api/client';
import * as keychain from '../src/store/keychain';

// Mock react-native-keychain
jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn().mockResolvedValue(true),
  getGenericPassword: jest.fn().mockResolvedValue({
    password: JSON.stringify({
      accessToken: 'initial-expired-token',
      refreshToken: 'valid-refresh-token',
    }),
  }),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
}));

describe('API Client Single-Flight Refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('proves three concurrent 401s trigger exactly one refresh call and retry once', async () => {
    let refreshCallCount = 0;
    let tasksCallCount = 0;

    const mockFetch = jest.fn().mockImplementation((url: string, options: any) => {
      if (url.includes('/api/auth/refresh')) {
        refreshCallCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              accessToken: 'new-valid-access-token',
              refreshToken: 'new-valid-refresh-token',
            }),
        });
      }

      if (url.includes('/api/tasks')) {
        tasksCallCount++;
        const authHeader = options?.headers?.Authorization || '';

        // Initial requests with the expired token return 401
        if (authHeader.includes('initial-expired-token')) {
          return Promise.resolve({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ message: 'Token expired' }),
          });
        }

        // Retried requests with the new token return 200 OK
        if (authHeader.includes('new-valid-access-token')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ tasks: [{ id: 'task-1' }] }),
          });
        }

        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: 'Unauthorized' }),
        });
      }

      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    // Assign mock fetch
    (globalThis as any).fetch = mockFetch;

    // Spy on saveTokens to update the mock keychain return value
    const saveTokensSpy = jest.spyOn(keychain, 'saveTokens');

    // Trigger three concurrent requests that all get 401
    const [res1, res2, res3] = await Promise.all([
      apiFetch<{ tasks: any[] }>('/api/tasks'),
      apiFetch<{ tasks: any[] }>('/api/tasks'),
      apiFetch<{ tasks: any[] }>('/api/tasks'),
    ]);

    // Invariant 1: Exactly ONE refresh call was made across all three concurrent 401s
    expect(refreshCallCount).toBe(1);

    // Invariant 2: Total calls to /api/tasks is 6 (3 initial 401s + 3 retried successes)
    expect(tasksCallCount).toBe(6);

    // Invariant 3: All three concurrent callers received their expected retried payload
    expect(res1).toEqual({ tasks: [{ id: 'task-1' }] });
    expect(res2).toEqual({ tasks: [{ id: 'task-1' }] });
    expect(res3).toEqual({ tasks: [{ id: 'task-1' }] });

    // Invariant 4: New tokens were persisted in Keychain
    expect(saveTokensSpy).toHaveBeenCalledWith({
      accessToken: 'new-valid-access-token',
      refreshToken: 'new-valid-refresh-token',
    });
  });
});
