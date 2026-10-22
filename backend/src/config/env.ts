import dotenv from 'dotenv';
import { z } from 'zod';

// Load variables from .env file if present (skip in test environment for hermetic test runs)
if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

export const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required and cannot be empty'),
  CORS_ORIGIN: z.string().default('*'),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters long'),
  ACCESS_TOKEN_TTL: z
    .string()
    .regex(/^\d+[smhd]$/, 'ACCESS_TOKEN_TTL must be a duration string matching format like 15m, 1h, 7d')
    .default('15m'),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(20),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  REFRESH_GRACE_SECONDS: z.coerce.number().int().min(0).max(300).default(10),
  REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  REFRESH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validates environment variables and returns sanitized configuration.
 * Fails fast with clear error messages without exposing sensitive values.
 */
export const validateEnv = (envInput: Record<string, unknown> = process.env): EnvConfig => {
  const result = envSchema.safeParse(envInput);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => issue.path.join('.') + ': ' + issue.message)
      .join('; ');
    throw new Error('Environment configuration validation failed. Invalid or missing variables: ' + errorDetails);
  }

  return result.data;
};

// Singleton configuration validated at module import time (safe defaults for test mode)
export const env: EnvConfig = process.env.NODE_ENV === 'test'
  ? {
      PORT: 5000,
      NODE_ENV: 'test',
      MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/modulus_test',
      CORS_ORIGIN: '*',
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'test_jwt_access_secret_for_vitest_min_32_chars_ok!',
      ACCESS_TOKEN_TTL: '15m',
      AUTH_RATE_LIMIT_WINDOW_MS: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
      AUTH_RATE_LIMIT_MAX: Number(process.env.AUTH_RATE_LIMIT_MAX) || 1000,
      REFRESH_TOKEN_TTL_DAYS: Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 30,
      REFRESH_GRACE_SECONDS: Number(process.env.REFRESH_GRACE_SECONDS) || 10,
      REFRESH_RATE_LIMIT_MAX: Number(process.env.REFRESH_RATE_LIMIT_MAX) || 1000,
      REFRESH_RATE_LIMIT_WINDOW_MS: Number(process.env.REFRESH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    }
  : validateEnv(process.env);
