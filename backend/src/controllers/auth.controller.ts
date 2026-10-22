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
 * Validates input, hashes password, saves user, and issues a token pair.
 */
export const register = async (req: Request, res: Response): Promise<void> => {
  // Validate input before any hashing or database calls
  const parseResult = authCredentialsSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  const { email, password } = parseResult.data;

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
    // Catch duplicate key error code 11000 from MongoDB unique index
    if ((error as { code?: number }).code === 11000) {
      res.status(409).json({
        status: 'error',
        message: 'An account with this email already exists',
      });
      return;
    }

    throw error;
  }
};

/**
 * Authenticate existing user with email and password.
 * Returns identical 401 error and equalized timing for unknown email vs wrong password.
 */
export const login = async (req: Request, res: Response): Promise<void> => {
  // Validate input before any hashing or database calls
  const parseResult = authCredentialsSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  const { email, password } = parseResult.data;

  const user = await User.findOne({ email });

  if (!user) {
    // Equalize timing against startup dummy hash when email does not exist
    await dummyVerifyPassword(password);
    res.status(401).json({
      status: 'error',
      message: 'Invalid email or password',
    });
    return;
  }

  const isValidPassword = await verifyPassword(user.passwordHash, password);
  if (!isValidPassword) {
    res.status(401).json({
      status: 'error',
      message: 'Invalid email or password',
    });
    return;
  }

  const { accessToken, refreshToken } = await issueTokenPair(user._id);

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    user: user.toJSON(),
    accessToken,
    refreshToken,
  });
};

/**
 * Rotate refresh token with grace window handling and reuse detection.
 */
export const refresh = async (req: Request, res: Response): Promise<void> => {
  const parseResult = refreshTokenSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  const result = await rotateRefreshToken(parseResult.data.refreshToken);

  if (!result.success) {
    res.status(result.status).json({
      status: 'error',
      message: result.message,
    });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  });
};

/**
 * Logout single session by revoking the refresh token. Idempotent.
 */
export const logout = async (req: Request, res: Response): Promise<void> => {
  const rawToken = req.body?.refreshToken;
  if (typeof rawToken === 'string' && /^[0-9a-f]{64}$/.test(rawToken)) {
    await revokeToken(rawToken);
  }

  res.status(204).send();
};

/**
 * Logout all sessions belonging to the authenticated user.
 */
export const logoutAll = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({
      status: 'error',
      message: 'Unauthorized',
    });
    return;
  }

  await revokeAllUserTokens(req.user._id);

  res.status(200).json({
    status: 'ok',
    message: 'All sessions logged out successfully',
  });
};

/**
 * Get profile of currently authenticated user.
 */
export const me = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({
      status: 'error',
      message: 'Unauthorized',
    });
    return;
  }

  res.status(200).json({
    user: req.user.toJSON(),
  });
};
