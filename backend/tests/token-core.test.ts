import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import crypto from 'crypto';
import { generateOpaqueToken, hashToken } from '../src/utils/token';
import { RefreshToken } from '../src/models/refresh-token.model';
import { connectDB, disconnectDB } from '../src/config/db';

describe('Token Core Utilities & RefreshToken Model', () => {
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDB(mongoServer.getUri());
  });

  afterAll(async () => {
    await disconnectDB();
    await mongoServer.stop();
  });

  describe('Token Utilities', () => {
    it('should generate a 64-character lowercase hex string (32 bytes entropy)', () => {
      const token = generateOpaqueToken();
      expect(typeof token).toBe('string');
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce distinct cryptographically random tokens on consecutive calls', () => {
      const token1 = generateOpaqueToken();
      const token2 = generateOpaqueToken();
      expect(token1).not.toBe(token2);
    });

    it('should compute deterministic SHA-256 hex digest', () => {
      const rawToken = '4a7f0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const hash = hashToken(rawToken);
      expect(hash).toBe(expectedHash);
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('RefreshToken Model Schema & toJSON', () => {
    it('should create a refresh token document with required fields and null defaults', async () => {
      const rawToken = generateOpaqueToken();
      const tokenHash = hashToken(rawToken);
      const userId = new mongoose.Types.ObjectId();
      const familyId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const record = await RefreshToken.create({
        tokenHash,
        userId,
        familyId,
        expiresAt,
      });

      expect(record._id).toBeDefined();
      expect(record.tokenHash).toBe(tokenHash);
      expect(record.userId.toString()).toBe(userId.toString());
      expect(record.familyId).toBe(familyId);
      expect(record.expiresAt).toEqual(expiresAt);
      expect(record.usedAt).toBeNull();
      expect(record.graceIssuedAt).toBeNull();
      expect(record.revokedAt).toBeNull();
      expect(record.createdAt).toBeInstanceOf(Date);

      // Verify toJSON strips tokenHash
      const json = record.toJSON();
      expect(json.id).toBe(record._id.toString());
      expect(json).not.toHaveProperty('tokenHash');
      expect(json).not.toHaveProperty('_id');
      expect(json).not.toHaveProperty('__v');
    });
  });
});
