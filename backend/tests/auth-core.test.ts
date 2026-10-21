import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express, { Request, Response } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { User } from '../src/models/user.model';
import { connectDB, disconnectDB } from '../src/config/db';
import { hashPassword, verifyPassword, dummyVerifyPassword } from '../src/utils/password';
import { signAccessToken, verifyAccessToken, JWT_ISSUER, JWT_AUDIENCE } from '../src/utils/jwt';
import { authenticate } from '../src/middleware/auth.middleware';
import { env } from '../src/config/env';

describe('Auth Core Utilities & Model Tests', () => {
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDB(mongoServer.getUri());
    await User.init(); // Ensure unique indexes are built
  });

  afterAll(async () => {
    await disconnectDB();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await User.deleteMany({});
  });

  it('User toJSON must never expose passwordHash', async () => {
    const user = new User({
      email: 'test@example.com',
      passwordHash: 'secret_argon2id_hash_string',
    });
    await user.save();

    const json = user.toJSON();
    expect(json).toHaveProperty('id');
    expect(json).toHaveProperty('email', 'test@example.com');
    expect(json).not.toHaveProperty('passwordHash');
    expect(json).not.toHaveProperty('_id');
    expect(json).not.toHaveProperty('__v');
  });

  it('User model enforces lowercase, trimming, and uniqueness', async () => {
    const user1 = new User({
      email: '  USER@EXAMPLE.COM ',
      passwordHash: 'hash1',
    });
    await user1.save();
    expect(user1.email).toBe('user@example.com');

    const user2 = new User({
      email: 'user@example.com',
      passwordHash: 'hash2',
    });

    await expect(user2.save()).rejects.toMatchObject({ code: 11000 });
  });

  it('Argon2id hashing, verification, and dummy verification', async () => {
    const password = 'CorrectPassword123!';
    const hash = await hashPassword(password);

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await verifyPassword(hash, 'WrongPassword123!')).toBe(false);

    // Dummy verification executes without throwing
    const dummyResult = await dummyVerifyPassword('randomPassword');
    expect(dummyResult).toBe(false);
  });

  it('JWT signing produces token with sub only, pinned HS256, issuer, and audience', () => {
    const userId = '64b0f925916327b88939b111';
    const token = signAccessToken(userId);

    const decodedHeader = jwt.decode(token, { complete: true }) as { header: { alg: string }; payload: Record<string, unknown> };
    expect(decodedHeader.header.alg).toBe('HS256');
    expect(decodedHeader.payload.iss).toBe(JWT_ISSUER);
    expect(decodedHeader.payload.aud).toBe(JWT_AUDIENCE);
    expect(decodedHeader.payload.sub).toBe(userId);
    expect(decodedHeader.payload).not.toHaveProperty('email');
    expect(decodedHeader.payload).toHaveProperty('exp');

    const verified = verifyAccessToken(token);
    expect(verified.sub).toBe(userId);
  });

  it('JWT verification rejects tampered, expired, and alg: none tokens', () => {
    const userId = '64b0f925916327b88939b111';
    const token = signAccessToken(userId);

    // Tampered token
    const tamperedToken = token.slice(0, -5) + 'abcde';
    expect(() => verifyAccessToken(tamperedToken)).toThrow();

    // Expired token
    const expiredToken = jwt.sign(
      { sub: userId },
      env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: -1 }
    );
    expect(() => verifyAccessToken(expiredToken)).toThrow();

    // alg: none token attack
    const noneAlgToken = jwt.sign(
      { sub: userId },
      '',
      { algorithm: 'none' as any, issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );
    expect(() => verifyAccessToken(noneAlgToken)).toThrow();
  });

  it('authenticate middleware protects endpoints and attaches req.user', async () => {
    const testApp = express();
    testApp.get('/protected', authenticate, (req: Request, res: Response) => {
      res.json({ success: true, user: req.user });
    });

    // Without token -> 401
    const noTokenRes = await request(testApp).get('/protected');
    expect(noTokenRes.status).toBe(401);
    expect(noTokenRes.body).toEqual({ status: 'error', message: 'Unauthorized' });

    // With invalid token -> 401
    const invalidTokenRes = await request(testApp).get('/protected').set('Authorization', 'Bearer invalid.token.here');
    expect(invalidTokenRes.status).toBe(401);

    // With valid user and token -> 200
    const user = await User.create({
      email: 'auth_test@example.com',
      passwordHash: await hashPassword('password123'),
    });
    const validToken = signAccessToken(user.id);

    const validRes = await request(testApp).get('/protected').set('Authorization', 'Bearer ' + validToken);
    expect(validRes.status).toBe(200);
    expect(validRes.body.success).toBe(true);
    expect(validRes.body.user).toHaveProperty('id', user.id);
    expect(validRes.body.user).not.toHaveProperty('passwordHash');
  });
});
