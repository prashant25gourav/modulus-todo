import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { register, login, me } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

export const authLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  // Dynamic limit allows env override per request, enabling dedicated testing and environment configuration
  limit: () => Number(process.env.AUTH_RATE_LIMIT_MAX) || env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    message: 'Too many authentication attempts, please try again later.',
  },
});

const router = Router();

// Apply auth rate limiter to all auth routes
router.use(authLimiter);

router.post('/register', register);
router.post('/login', login);
router.get('/me', authenticate, me);

export default router;
