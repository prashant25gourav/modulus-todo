import { API_BASE_URL, API_TIMEOUT_MS } from '../config';
import { getTokens, saveTokens, clearTokens } from '../store/keychain';

export class ApiError extends Error {
  statusCode: number;
  errors?: Array<{ field: string; message: string }>;

  constructor(
    message: string,
    statusCode: number,
    errors?: Array<{ field: string; message: string }>
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

let activeRefreshPromise: Promise<string | null> | null = null;
let onSessionExpired: (() => void) | null = null;

export const setSessionExpiredCallback = (callback: () => void) => {
  onSessionExpired = callback;
};

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  skipAuth?: boolean;
  _retry?: boolean;
}

export const executeRefresh = async (): Promise<string | null> => {
  try {
    const tokens = await getTokens();
    if (!tokens?.refreshToken) {
      if (onSessionExpired) {
        onSessionExpired();
      }
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      await clearTokens();
      if (onSessionExpired) {
        onSessionExpired();
      }
      return null;
    }

    const data = await response.json();
    const newTokens = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    };
    await saveTokens(newTokens);
    return newTokens.accessToken;
  } catch {
    await clearTokens();
    if (onSessionExpired) {
      onSessionExpired();
    }
    return null;
  }
};

export const apiFetch = async <T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T> => {
  const {
    timeoutMs = API_TIMEOUT_MS,
    skipAuth = false,
    _retry = false,
    headers = {},
    ...restOptions
  } = options;

  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string>),
  };

  if (!skipAuth && !reqHeaders.Authorization) {
    const tokens = await getTokens();
    if (tokens?.accessToken) {
      reqHeaders.Authorization = `Bearer ${tokens.accessToken}`;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      ...restOptions,
      headers: reqHeaders,
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new ApiError('Request timed out. Please try again.', 408);
    }
    throw new ApiError(
      error instanceof Error ? error.message : 'Network request failed',
      0
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle 401 Unauthorized with single-flight token refresh
  if (
    response.status === 401 &&
    !skipAuth &&
    !_retry &&
    !path.includes('/api/auth/refresh') &&
    !path.includes('/api/auth/login')
  ) {
    if (!activeRefreshPromise) {
      activeRefreshPromise = executeRefresh().finally(() => {
        activeRefreshPromise = null;
      });
    }

    const newAccessToken = await activeRefreshPromise;
    if (newAccessToken) {
      // Retry request once with newly obtained access token
      return apiFetch<T>(path, {
        ...options,
        _retry: true,
        headers: {
          ...headers,
          Authorization: `Bearer ${newAccessToken}`,
        },
      });
    } else {
      throw new ApiError('Session expired. Please log in again.', 401);
    }
  }

  if (response.status === 204) {
    return {} as T;
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.message || `Request failed with status ${response.status}`;
    const errors = Array.isArray(data?.errors) ? data.errors : undefined;
    throw new ApiError(message, response.status, errors);
  }

  return data as T;
};
