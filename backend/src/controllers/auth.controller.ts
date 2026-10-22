import { Request, Response } from 'express';
import { z } from 'zod';
import { User } from '../models/user.model';
import { hashPassword, verifyPassword, dummyVerifyPassword } from '../utils/password';
import {
  issueTokenPair,
  rotateRefreshToken,
  revokeToken,
  revokeAllUserTokens,
} from '../services/token.service';
import { AppError, asyncHandler } from '../utils/errors';

// Validation schemas with strict string validation
export const authCredentialsSchema = z.object({
  email: z
    .string('Email must be a string')
    .trim()
    .toLowerCase()
    .max(254, 'Email cannot exceed 254 characters')
    .email('Invalid email address format'),
  password: z
    .string('Password must be a string')
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password cannot exceed 128 characters'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z
    .string('Refresh token must be a string')
    .regex(/^[0-9a-f]{64}$/, 'Invalid refresh token format'),
});

/**
 * Register a new user account.
 */
export const register = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { email, password } = res.locals.body as z.infer<typeof authCredentialsSchema>;

  try {
    const passwordHash = await hashPassword(password);
    const user = new User({ email, passwordHash });
    await user.save();

    const { accessToken, refreshToken } = await issueTokenPair(user._id);

    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({
      user: user.toJSON(),
      accessToken,
      refreshToken,
    });
  } catch (error: unknown) {
    if ((error as { code?: number }).code === 11000) {
      throw new AppError('An account with this email already exists', 409);
    }
    throw error;
  }
});

/**
 * Authenticate existing user with email and password.
 */
export const login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { email, password } = res.locals.body as z.infer<typeof authCredentialsSchema>;

  const user = await User.findOne({ email });

  if (!user) {
    await dummyVerifyPassword(password);
    throw new AppError('Invalid email or password', 401);
  }

  const isValidPassword = await verifyPassword(user.passwordHash, password);
  if (!isValidPassword) {
    throw new AppError('Invalid email or password', 401);
  }

  const { accessToken, refreshToken } = await issueTokenPair(user._id);

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    user: user.toJSON(),
    accessToken,
    refreshToken,
  });
});

/**
 * Rotate refresh token with grace window handling and reuse detection.
 */
export const refresh = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { refreshToken: rawRefreshToken } = res.locals.body as z.infer<typeof refreshTokenSchema>;

  const result = await rotateRefreshToken(rawRefreshToken);

  if (!result.success) {
    throw new AppError(result.message, result.status);
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  });
});

/**
 * Logout single session by revoking the refresh token. Idempotent (returns 204).
 */
export const logout = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const rawToken = req.body?.refreshToken;
  if (typeof rawToken === 'string' && /^[0-9a-f]{64}$/.test(rawToken)) {
    await revokeToken(rawToken);
  }

  res.status(204).send();
});

/**
 * Logout all sessions belonging to the authenticated user.
 */
export const logoutAll = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  await revokeAllUserTokens(req.user._id);

  res.status(200).json({
    status: 'ok',
    message: 'All sessions logged out successfully',
  });
});

/**
 * Get profile of currently authenticated user.
 */
export const me = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  res.status(200).json({
    user: req.user.toJSON(),
  });
});
