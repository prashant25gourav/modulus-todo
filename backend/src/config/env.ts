import dotenv from 'dotenv';
import { z } from 'zod';

// Load variables from .env file if present
dotenv.config();

export const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required and cannot be empty'),
  CORS_ORIGIN: z.string().default('*'),
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

// Singleton configuration validated at module import time (except during tests that mock process.env)
export const env: EnvConfig = process.env.NODE_ENV === 'test'
  ? {
      PORT: 5000,
      NODE_ENV: 'test',
      MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/modulus_test',
      CORS_ORIGIN: '*',
    }
  : validateEnv(process.env);
