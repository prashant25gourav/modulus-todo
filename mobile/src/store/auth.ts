import { create } from 'zustand';
import { apiFetch, ApiError, setSessionExpiredCallback } from '../api/client';
import { getTokens, saveTokens, clearTokens } from './keychain';

export interface User {
  id: string;
  email: string;
  createdAt: string;
  updatedAt?: string;
}

interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isRestoring: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => {
  // Register callback so client.ts refresh failures clear authentication state
  setSessionExpiredCallback(() => {
    set({ user: null, isAuthenticated: false });
  });

  return {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    isRestoring: true,
    error: null,

    clearError: () => set({ error: null }),

    restoreSession: async () => {
      set({ isRestoring: true, error: null });
      try {
        const tokens = await getTokens();
        if (!tokens || !tokens.refreshToken) {
          set({ user: null, isAuthenticated: false, isRestoring: false });
          return;
        }

        // Validate session by requesting user profile (/api/auth/me)
        // If the access token is expired, apiFetch's single-flight refresh will handle it
        const res = await apiFetch<{ user: User }>('/api/auth/me');
        set({ user: res.user, isAuthenticated: true, isRestoring: false });
      } catch {
        await clearTokens();
        set({ user: null, isAuthenticated: false, isRestoring: false });
      }
    },

    login: async (email: string, password: string) => {
      set({ isLoading: true, error: null });
      try {
        const res = await apiFetch<AuthResponse>('/api/auth/login', {
          method: 'POST',
          skipAuth: true,
          body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
        });

        await saveTokens({
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
        });

        set({ user: res.user, isAuthenticated: true, isLoading: false });
      } catch (err: unknown) {
        const message =
          err instanceof ApiError ? err.message : 'Login failed. Please check your network connection.';
        set({ error: message, isLoading: false });
        throw err;
      }
    },

    register: async (email: string, password: string) => {
      set({ isLoading: true, error: null });
      try {
        const res = await apiFetch<AuthResponse>('/api/auth/register', {
          method: 'POST',
          skipAuth: true,
          body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
        });

        await saveTokens({
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
        });

        set({ user: res.user, isAuthenticated: true, isLoading: false });
      } catch (err: unknown) {
        const message =
          err instanceof ApiError ? err.message : 'Registration failed. Please check your network connection.';
        set({ error: message, isLoading: false });
        throw err;
      }
    },

    logout: async () => {
      set({ isLoading: true });
      try {
        const tokens = await getTokens();
        if (tokens?.refreshToken) {
          await apiFetch('/api/auth/logout', {
            method: 'POST',
            skipAuth: true,
            body: JSON.stringify({ refreshToken: tokens.refreshToken }),
          }).catch(() => {
            // Ignore backend logout error, always proceed to clear local Keychain
          });
        }
      } finally {
        await clearTokens();
        set({ user: null, isAuthenticated: false, isLoading: false, error: null });
      }
    },
  };
});
