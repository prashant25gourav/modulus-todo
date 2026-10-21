import { describe, it, expect } from 'vitest';
import { validateEnv } from '../src/config/env';

describe('Environment Validation', () => {
  it('should validate successfully when all required fields are present', () => {
    const validConfig = validateEnv({
      PORT: '4000',
      NODE_ENV: 'development',
      MONGODB_URI: 'mongodb://localhost:27017/test_db',
      CORS_ORIGIN: 'http://localhost:3000',
      JWT_ACCESS_SECRET: 'super_secret_jwt_access_token_key_at_least_32_chars_long!',
      ACCESS_TOKEN_TTL: '30m',
    });

    expect(validConfig.PORT).toBe(4000);
    expect(validConfig.NODE_ENV).toBe('development');
    expect(validConfig.MONGODB_URI).toBe('mongodb://localhost:27017/test_db');
    expect(validConfig.JWT_ACCESS_SECRET).toBe('super_secret_jwt_access_token_key_at_least_32_chars_long!');
    expect(validConfig.ACCESS_TOKEN_TTL).toBe('30m');
  });

  it('should fail fast with clear error message when MONGODB_URI is missing', () => {
    expect(() => {
      validateEnv({
        PORT: '4000',
        NODE_ENV: 'development',
        JWT_ACCESS_SECRET: 'super_secret_jwt_access_token_key_at_least_32_chars_long!',
      });
    }).toThrowError(/MONGODB_URI/);
  });

  it('should fail fast when JWT_ACCESS_SECRET is missing or less than 32 characters', () => {
    expect(() => {
      validateEnv({
        MONGODB_URI: 'mongodb://localhost:27017/test_db',
        JWT_ACCESS_SECRET: 'too_short_secret',
      });
    }).toThrowError(/JWT_ACCESS_SECRET/);
  });

  it('should not leak secret values in error messages on validation failure', () => {
    try {
      validateEnv({
        PORT: 'invalid-port-string',
        MONGODB_URI: '',
        JWT_ACCESS_SECRET: 'short_secret_value_123',
      });
      expect.unreachable('Should have thrown an error');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('Environment configuration validation failed');
      expect(message).not.toContain('short_secret_value_123');
      expect(message).not.toContain('invalid-port-string');
    }
  });
});
