import { describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { connectDB, redactUri, logger } from '../src/config/db';

describe('Database Connection Security & Error Redaction', () => {
  it('should redact sensitive MongoDB and MongoDB+SRV URIs correctly', () => {
    const rawStandardUri = 'Failed to connect to mongodb://admin:secretPass123@cluster0.mongodb.net/test';
    const rawSrvUri = 'Failed to connect to mongodb+srv://app_user:p@ssword!@main.xyz.mongodb.net/prod?retryWrites=true';

    expect(redactUri(rawStandardUri)).toBe('Failed to connect to [redacted]');
    expect(redactUri(rawSrvUri)).toBe('Failed to connect to [redacted]');
    expect(redactUri(rawStandardUri)).not.toContain('secretPass123');
    expect(redactUri(rawSrvUri)).not.toContain('p@ssword!');
  });

  it('should log redacted error details (name, code, message) and hide credentials on real connection failure', async () => {
    const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    // Use a short serverSelectionTimeoutMS so connection fails fast in test
    const sensitiveUri = 'mongodb://supersecretuser:supersecretpass@127.0.0.1:59999/isolated_test?serverSelectionTimeoutMS=500';

    await expect(connectDB(sensitiveUri)).rejects.toThrow();

    expect(loggerSpy).toHaveBeenCalled();
    const loggedPayload = loggerSpy.mock.calls[0][0] as {
      errName: string;
      errCode: string | number;
      errMessage: string;
    };

    expect(loggedPayload).toHaveProperty('errName');
    expect(loggedPayload).toHaveProperty('errCode');
    expect(loggedPayload).toHaveProperty('errMessage');

    // Prove credentials and raw URI are never logged
    expect(loggedPayload.errMessage).not.toContain('supersecretuser');
    expect(loggedPayload.errMessage).not.toContain('supersecretpass');
    expect(loggedPayload.errMessage).not.toContain('mongodb://');

    loggerSpy.mockRestore();
  });

  it('should redact connection URI if the underlying driver error message contains a connection string', async () => {
    const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const mongooseSpy = vi.spyOn(mongoose, 'connect').mockRejectedValueOnce(
      new Error('Connection timed out while connecting to mongodb+srv://dbuser:supersecretpass@cluster0.abc.mongodb.net/prod')
    );

    await expect(connectDB('mongodb+srv://dbuser:supersecretpass@cluster0.abc.mongodb.net/prod')).rejects.toThrow();

    expect(loggerSpy).toHaveBeenCalled();
    const loggedPayload = loggerSpy.mock.calls[0][0] as {
      errName: string;
      errCode: string | number;
      errMessage: string;
    };

    expect(loggedPayload.errMessage).toBe('Connection timed out while connecting to [redacted]');
    expect(loggedPayload.errMessage).not.toContain('supersecretpass');
    expect(loggedPayload.errMessage).not.toContain('mongodb+srv://');

    mongooseSpy.mockRestore();
    loggerSpy.mockRestore();
  });
});
