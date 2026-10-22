import express from 'express';
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import mongoose from 'mongoose';
import app from '../src/app';
import { connectDB, disconnectDB } from '../src/config/db';
import { User } from '../src/models/user.model';
import { env } from '../src/config/env';
import { authLimiter, createAuthLimiter } from '../src/routes/auth.routes';
import * as passwordUtils from '../src/utils/password';

describe('Authentication & Security Integration Suite', () => {
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await connectDB(uri);
    // Ensure unique indexes (email) are built in the memory database
    await User.init();
  });

  afterAll(async () => {
    await disconnectDB();
    await mongoServer.stop();
  });

  afterEach(async () => {
    await User.deleteMany({});
    await authLimiter.resetKey('127.0.0.1');
    await authLimiter.resetKey('::ffff:127.0.0.1');
    await authLimiter.resetKey('::1');
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user and return 201 with user object and JWT token', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'newuser@example.com',
          password: 'Password123!',
        });

      expect(response.status).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).not.toHaveProperty('token');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.email).toBe('newuser@example.com');
      expect(response.body.user.createdAt).toBeDefined();
      expect(response.body.user.updatedAt).toBeDefined();
      expect(response.body.user.passwordHash).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');

      // Verify access token can be decoded
      const decoded = jwt.decode(response.body.accessToken) as { sub: string; iss: string; aud: string };
      expect(decoded.sub).toBe(response.body.user.id);
      expect(decoded.iss).toBe('modulus-todo-api');
      expect(decoded.aud).toBe('modulus-todo-app');
    });

    it('should normalize email whitespace and casing on registration (same account for whitespace/casing variations)', async () => {
      const reg1 = await request(app)
        .post('/api/auth/register')
        .send({
          email: '   A@B.COM   ',
          password: 'Password123!',
        });

      expect(reg1.status).toBe(201);
      expect(reg1.body.user.email).toBe('a@b.com');

      // Attempt registering normalized equivalent
      const reg2 = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'a@b.com',
          password: 'Password123!',
        });

      expect(reg2.status).toBe(409);
      expect(reg2.body.message).toBe('An account with this email already exists');
    });

    it('should return 409 via Mongo error code 11000 on duplicate email', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'Password123!',
        });

      const duplicateResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'DifferentPassword123!',
        });

      expect(duplicateResponse.status).toBe(409);
      expect(duplicateResponse.body).toEqual({
        status: 'error',
        message: 'An account with this email already exists',
      });
      expect(JSON.stringify(duplicateResponse.body)).not.toContain('passwordHash');
    });

    it('should reject password of 129 characters with 400 without calling argon2 (spy check)', async () => {
      const hashSpy = vi.spyOn(argon2, 'hash');

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'lengthtest@example.com',
          password: 'a'.repeat(129),
        });

      expect(response.status).toBe(400);
      expect(response.body.status).toBe('error');
      expect(hashSpy).not.toHaveBeenCalled();
      hashSpy.mockRestore();
    });

    it('should reject Mongo query injection object {"email": {"$gt": ""}, "password": "x"} with 400', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: { $gt: '' },
          password: 'x',
        });

      expect(response.status).toBe(400);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toBe('Validation failed');
    });

    it('should reject password with less than 8 characters with 400', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'shortpass@example.com',
          password: 'short',
        });

      expect(response.status).toBe(400);
      expect(response.body.status).toBe('error');
    });

    it('should reject non-string password with 400', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'objectpass@example.com',
          password: { $gt: '' },
        });

      expect(response.status).toBe(400);
      expect(response.body.status).toBe('error');
    });

    it('should never expose passwordHash in any response body', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'secureuser@example.com',
          password: 'Password123!',
        });

      expect(response.status).toBe(201);
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
      expect(response.body.user.passwordHash).toBeUndefined();
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      // Create test account for login tests
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'existing@example.com',
          password: 'CorrectPassword123!',
        });
    });

    it('should return 200 with user and token on correct credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'existing@example.com',
          password: 'CorrectPassword123!',
        });

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).not.toHaveProperty('token');
      expect(response.body.user.email).toBe('existing@example.com');
      expect(response.body.user.passwordHash).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    });

    it('should return identical 401 status and body for wrong password and unknown email', async () => {
      const wrongPasswordResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'existing@example.com',
          password: 'WrongPassword999!',
        });

      const unknownEmailResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'unknown-email@example.com',
          password: 'WrongPassword999!',
        });

      expect(wrongPasswordResponse.status).toBe(401);
      expect(unknownEmailResponse.status).toBe(401);
      expect(wrongPasswordResponse.body).toEqual(unknownEmailResponse.body);
      expect(wrongPasswordResponse.body).toEqual({
        status: 'error',
        message: 'Invalid email or password',
      });
      expect(JSON.stringify(wrongPasswordResponse.body)).not.toContain('passwordHash');
      expect(JSON.stringify(unknownEmailResponse.body)).not.toContain('passwordHash');
    });

    it('should invoke dummyVerifyPassword when email does not exist to equalize timing', async () => {
      const dummySpy = vi.spyOn(passwordUtils, 'dummyVerifyPassword');

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'ArbitraryPassword123!',
        });

      expect(response.status).toBe(401);
      expect(dummySpy).toHaveBeenCalledWith('ArbitraryPassword123!');
      dummySpy.mockRestore();
    });

    it('should reject Mongo query injection object {"email": {"$gt": ""}, "password": "x"} with 400 on login', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: { $gt: '' },
          password: 'x',
        });

      expect(response.status).toBe(400);
      expect(response.body.status).toBe('error');
    });
  });

  describe('GET /api/auth/me', () => {
    let validToken: string;
    let userId: string;

    beforeEach(async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'me-user@example.com',
          password: 'Password123!',
        });
      validToken = reg.body.accessToken;
      userId = reg.body.user.id;
    });

    it('should return 200 with user profile for a valid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.id).toBe(userId);
      expect(response.body.user.email).toBe('me-user@example.com');
      expect(response.body.user.passwordHash).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    });

    it('should return 401 when Authorization header is missing', async () => {
      const response = await request(app).get('/api/auth/me');
      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        status: 'error',
        message: 'Unauthorized',
      });
    });

    it('should return 401 for token with wrong issuer', async () => {
      const wrongIssuerToken = jwt.sign(
        { sub: userId },
        env.JWT_ACCESS_SECRET,
        {
          algorithm: 'HS256',
          issuer: 'wrong-issuer-service',
          audience: 'modulus-todo-app',
          expiresIn: '15m',
        }
      );

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${wrongIssuerToken}`);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Unauthorized');
    });

    it('should return 401 for token with wrong audience', async () => {
      const wrongAudienceToken = jwt.sign(
        { sub: userId },
        env.JWT_ACCESS_SECRET,
        {
          algorithm: 'HS256',
          issuer: 'modulus-todo-api',
          audience: 'wrong-client-app',
          expiresIn: '15m',
        }
      );

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${wrongAudienceToken}`);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Unauthorized');
    });

    it('should return 401 for token signed with wrong secret', async () => {
      const wrongSecretToken = jwt.sign(
        { sub: userId },
        'different_unauthorized_secret_key_32_characters_minimum!',
        {
          algorithm: 'HS256',
          issuer: 'modulus-todo-api',
          audience: 'modulus-todo-app',
          expiresIn: '15m',
        }
      );

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${wrongSecretToken}`);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Unauthorized');
    });

    it('should return 401 for a valid token belonging to a deleted user', async () => {
      // Delete user from database
      await User.findByIdAndDelete(userId);

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Unauthorized');
    });

    it('should return 401 for a token whose sub is not a valid ObjectId', async () => {
      const invalidSubToken = jwt.sign(
        { sub: 'not-an-object-id-value' },
        env.JWT_ACCESS_SECRET,
        {
          algorithm: 'HS256',
          issuer: 'modulus-todo-api',
          audience: 'modulus-todo-app',
          expiresIn: '15m',
        }
      );

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${invalidSubToken}`);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Unauthorized');
    });

    it('should return 401 for a token with no exp (expiration)', async () => {
      // Craft a token without expiration
      const noExpToken = jwt.sign(
        { sub: new mongoose.Types.ObjectId().toHexString() },
        env.JWT_ACCESS_SECRET,
        {
          algorithm: 'HS256',
          issuer: 'modulus-todo-api',
          audience: 'modulus-todo-app',
          // no expiresIn
        }
      );

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${noExpToken}`);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Unauthorized');
    });
  });

  describe('API Behavior & Body Limits', () => {
    it('should return consistent JSON 400 and no stack trace on malformed JSON payload', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "test@example.com", "password": ');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        status: 'error',
        message: 'Malformed JSON payload',
      });
      expect(response.body.stack).toBeUndefined();
    });

    it('should return consistent JSON 413 and no stack trace on oversized body (> 10kb)', async () => {
      const largePayload = {
        email: 'test@example.com',
        password: 'x'.repeat(15 * 1024),
      };

      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(largePayload));

      expect(response.status).toBe(413);
      expect(response.body).toEqual({
        status: 'error',
        message: 'Payload too large',
      });
      expect(response.body.stack).toBeUndefined();
    });
  });

  describe('Auth Rate Limiter', () => {
    it('should return 429 after exceeding the configured auth rate limit using createAuthLimiter', async () => {
      const testApp = express();
      testApp.use(express.json());
      const testLimiter = createAuthLimiter({ limit: 3, windowMs: 60000 });
      testApp.post('/test-login', testLimiter, (_req, res) => {
        res.status(200).json({ ok: true });
      });

      for (let i = 0; i < 3; i++) {
        const res = await request(testApp).post('/test-login');
        expect(res.status).toBe(200);
      }

      const blockedRes = await request(testApp).post('/test-login');
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body).toEqual({
        status: 'error',
        message: 'Too many authentication attempts, please try again later.',
      });
    });

    it('should ensure /me is not affected by the strict auth rate limiter', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'me-ratelimit@example.com',
          password: 'Password123!',
        });

      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${reg.body.accessToken}`);
        expect(res.status).toBe(200);
      }
    });
  });
});
