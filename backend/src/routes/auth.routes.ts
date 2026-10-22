import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  me,
  authCredentialsSchema,
  refreshTokenSchema,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';

export interface AuthLimiterOptions {
  windowMs?: number;
  limit?: number;
}

/**
 * Factory for creating auth rate limiters for register and login.
 */
export const createAuthLimiter = (options?: AuthLimiterOptions) => {
  return rateLimit({
    windowMs: options?.windowMs ?? env.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: options?.limit ?? env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      status: 'error',
      message: 'Too many authentication attempts, please try again later.',
    },
  });
};

export const authLimiter = createAuthLimiter();

export interface RefreshLimiterOptions {
  windowMs?: number;
  limit?: number;
}

/**
 * Factory for creating refresh rate limiters (with separate, more generous limits).
 */
export const createRefreshLimiter = (options?: RefreshLimiterOptions) => {
  return rateLimit({
    windowMs: options?.windowMs ?? env.REFRESH_RATE_LIMIT_WINDOW_MS,
    limit: options?.limit ?? env.REFRESH_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      status: 'error',
      message: 'Too many refresh attempts, please try again later.',
    },
  });
};

export const refreshLimiter = createRefreshLimiter();

const router = Router();

// Strict rate limiting and validation for credential-based authentication
router.post('/register', authLimiter, validateBody(authCredentialsSchema), register);
router.post('/login', authLimiter, validateBody(authCredentialsSchema), login);

// Dedicated rate limiting and validation for token refresh
router.post('/refresh', refreshLimiter, validateBody(refreshTokenSchema), refresh);

// Session revocation endpoints
router.post('/logout', logout);
router.post('/logout-all', authenticate, logoutAll);

// Authenticated session profile endpoint falls under global rate limiter only
router.get('/me', authenticate, me);

export default router;
