import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { register, login, me } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

export interface AuthLimiterOptions {
  windowMs?: number;
  limit?: number;
}

/**
 * Factory for creating auth rate limiters with configurable limits and window.
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

const router = Router();

// Apply auth rate limiter strictly to sensitive authentication endpoints
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);

// Authenticated session profile endpoint falls under global rate limiter only
router.get('/me', authenticate, me);

export default router;
