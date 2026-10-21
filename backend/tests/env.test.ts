import { describe, it, expect } from 'vitest';
import { validateEnv } from '../src/config/env';

describe('Environment Validation', () => {
  it('should validate successfully when all required fields are present', () => {
    const validConfig = validateEnv({
      PORT: '4000',
      NODE_ENV: 'development',
      MONGODB_URI: 'mongodb://localhost:27017/test_db',
      CORS_ORIGIN: 'http://localhost:3000',
    });

    expect(validConfig.PORT).toBe(4000);
    expect(validConfig.NODE_ENV).toBe('development');
    expect(validConfig.MONGODB_URI).toBe('mongodb://localhost:27017/test_db');
  });

  it('should fail fast with clear error message when MONGODB_URI is missing', () => {
    expect(() => {
      validateEnv({
        PORT: '4000',
        NODE_ENV: 'development',
      });
    }).toThrowError(/MONGODB_URI/);
  });

  it('should not leak secret values in error messages on validation failure', () => {
    try {
      validateEnv({
        PORT: 'invalid-port-string',
        MONGODB_URI: '',
      });
      expect.unreachable('Should have thrown an error');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('Environment configuration validation failed');
      expect(message).not.toContain('invalid-port-string');
    }
  });
});
