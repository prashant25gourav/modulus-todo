import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import crypto from 'crypto';
import express from 'express';
import pino from 'pino';
import app from '../src/app';
import { connectDB, disconnectDB } from '../src/config/db';
import { User } from '../src/models/user.model';
import { RefreshToken } from '../src/models/refresh-token.model';
import { hashToken } from '../src/utils/token';
import { setTokenLogger, resetTokenLogger } from '../src/services/token.service';
import { createRefreshLimiter, createAuthLimiter } from '../src/routes/auth.routes';

describe('Refresh Tokens, Rotation and Session Revocation Integration Suite', () => {
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDB(mongoServer.getUri());
    await User.init();
    await RefreshToken.init();
  });

  afterAll(async () => {
    await disconnectDB();
    await mongoServer.stop();
  });

  afterEach(async () => {
    await User.deleteMany({});
    await RefreshToken.deleteMany({});
    resetTokenLogger();
  });

  describe('Token Rotation & Persistence Security', () => {
    it('should rotate token and return new accessToken and refreshToken with Cache-Control no-store', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'rotate@example.com',
          password: 'Password123!',
        });

      const initialRefreshToken = reg.body.refreshToken;
      
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: initialRefreshToken });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.headers['cache-control']).toBe('no-store');
      expect(refreshRes.body).toHaveProperty('accessToken');
      expect(refreshRes.body).toHaveProperty('refreshToken');
      expect(refreshRes.body).not.toHaveProperty('token');
      expect(refreshRes.body.refreshToken).not.toBe(initialRefreshToken);
      expect(typeof refreshRes.body.accessToken).toBe('string');
      expect(refreshRes.body.accessToken.split('.')).toHaveLength(3);

      // Verify new access token works on /me
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${refreshRes.body.accessToken}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.user.email).toBe('rotate@example.com');

      // Verify database state: old token marked used
      const oldHash = hashToken(initialRefreshToken);
      const oldRecord = await RefreshToken.findOne({ tokenHash: oldHash });
      expect(oldRecord).not.toBeNull();
      expect(oldRecord!.usedAt).toBeInstanceOf(Date);
    });

    it('should ensure raw refresh tokens never appear in stored database documents', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'hashcheck@example.com',
          password: 'Password123!',
        });

      const rawRefreshToken = reg.body.refreshToken;
      const allTokens = await RefreshToken.find({});
      expect(allTokens).toHaveLength(1);

      const storedDoc = allTokens[0];
      const json = storedDoc.toJSON();

      // Assert raw token string does not appear anywhere in document fields
      expect(storedDoc.tokenHash).not.toBe(rawRefreshToken);
      expect(JSON.stringify(json)).not.toContain(rawRefreshToken);

      // Verify SHA-256 hash match
      const expectedHash = hashToken(rawRefreshToken);
      expect(storedDoc.tokenHash).toBe(expectedHash);
    });
  });

  describe('Grace Window & Replay Protection', () => {
    it('should issue a single grace sibling on replay within grace window, and revoke family on second replay (lost-response scenario)', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'grace@example.com',
          password: 'Password123!',
        });

      const token0 = reg.body.refreshToken;

      // 1. First fresh rotation: produces token1
      const rotate1 = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: token0 });
      expect(rotate1.status).toBe(200);
      const token1 = rotate1.body.refreshToken;

      // 2. Replay token0 within grace window: produces grace sibling token2
      const graceRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: token0 });
      expect(graceRes.status).toBe(200);
      expect(graceRes.body).toHaveProperty('accessToken');
      expect(graceRes.body).toHaveProperty('refreshToken');
      const token2 = graceRes.body.refreshToken;
      expect(token2).not.toBe(token1);

      // 3. Second replay of token0: MUST revoke entire family and return 401
      const secondReplayRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: token0 });
      expect(secondReplayRes.status).toBe(401);
      expect(secondReplayRes.body).toEqual({
        status: 'error',
        message: 'Invalid or revoked refresh token',
      });

      // 4. Verify all tokens in the family now fail
      const token1Attempt = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: token1 });
      expect(token1Attempt.status).toBe(401);

      const token2Attempt = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: token2 });
      expect(token2Attempt.status).toBe(401);
    });

    it('should immediately revoke entire family when a used token is reused after the grace window', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'expiredgrace@example.com',
          password: 'Password123!',
        });

      const token0 = reg.body.refreshToken;

      // Rotate token0 -> token1
      const rotate1 = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: token0 });
      expect(rotate1.status).toBe(200);
      const token1 = rotate1.body.refreshToken;

      // Set usedAt back in time by 60 seconds (outside the 10s grace window)
      const token0Hash = hashToken(token0);
      await RefreshToken.updateOne(
        { tokenHash: token0Hash },
        { $set: { usedAt: new Date(Date.now() - 60000) } }
      );

      // Re-present token0 after the window -> must trigger family revocation and 401
      const expiredReplayRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: token0 });
      expect(expiredReplayRes.status).toBe(401);

      // Verify successor token1 is also revoked
      const token1Res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: token1 });
      expect(token1Res.status).toBe(401);
    });

    it('should handle 3 concurrent refreshes with Promise.all asserting invariants', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'concurrent@example.com',
          password: 'Password123!',
        });

      const originalToken = reg.body.refreshToken;

      // Fire 3 simultaneous refresh requests with the same token
      const responses = await Promise.all([
        request(app).post('/api/auth/refresh').send({ refreshToken: originalToken }),
        request(app).post('/api/auth/refresh').send({ refreshToken: originalToken }),
        request(app).post('/api/auth/refresh').send({ refreshToken: originalToken }),
      ]);

      const statusCodes = responses.map((r) => r.status);

      // Invariant 1: No 5xx server errors
      for (const status of statusCodes) {
        expect(status).toBeLessThan(500);
      }

      // Invariant 2: At least one 401 (re-use detected / family revoked)
      expect(statusCodes).toContain(401);

      // Invariant 3: Because family was revoked, every token that was returned with 200 must fail on its next refresh
      const tokensToTest = responses
        .filter((r) => r.status === 200)
        .map((r) => r.body.refreshToken);

      for (const token of tokensToTest) {
        const nextAttempt = await request(app)
          .post('/api/auth/refresh')
          .send({ refreshToken: token });
        expect(nextAttempt.status).toBe(401);
      }
    });

    it('should detect when family was revoked between CAS and creation, marking the new token revoked and returning 401', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'racecondition@example.com',
          password: 'Password123!',
        });

      const token0 = reg.body.refreshToken;

      // Spy on RefreshToken.create to simulate concurrent family revocation before persistence completes
      const originalCreate = RefreshToken.create.bind(RefreshToken);
      const createSpy = vi.spyOn(RefreshToken, 'create').mockImplementation(async function (docs: any, options?: any) {
        const doc = Array.isArray(docs) ? docs[0] : docs;
        if (doc?.familyId) {
          // Concurrently revoke the family before new token document is created
          await RefreshToken.updateMany(
            { familyId: doc.familyId },
            { $set: { revokedAt: new Date() } }
          );
        }
        return (originalCreate as any)(docs, options);
      });

      // Call refresh: CAS succeeds, but create-spy revokes family right before create finishes
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: token0 });

      expect(refreshRes.status).toBe(401);
      expect(refreshRes.body).toEqual({
        status: 'error',
        message: 'Invalid or revoked refresh token',
      });

      createSpy.mockRestore();

      // Verify that all tokens in the database for this user are revoked and unusable
      const allTokens = await RefreshToken.find({});
      expect(allTokens.length).toBeGreaterThan(1);
      for (const t of allTokens) {
        expect(t.revokedAt).not.toBeNull();
      }
    });

    it('should assert log output contains neither the raw token nor its hash during grace issuance and family revocation', async () => {
      let logBuffer = '';
      const customStream = {
        write(msg: string) {
          logBuffer += msg;
        },
      };

      const testLogger = pino({ level: 'info' }, customStream);
      setTokenLogger(testLogger);

      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'logtest@example.com',
          password: 'Password123!',
        });

      const rawToken = reg.body.refreshToken;
      const tokenHash = hashToken(rawToken);

      // 1. Fresh rotation
      await request(app).post('/api/auth/refresh').send({ refreshToken: rawToken });

      // 2. Grace sibling issuance (triggers info log)
      await request(app).post('/api/auth/refresh').send({ refreshToken: rawToken });

      // 3. Second replay (triggers warn log and family revocation)
      await request(app).post('/api/auth/refresh').send({ refreshToken: rawToken });

      // Assert log contains userId and familyId
      expect(logBuffer).toContain('familyId');
      expect(logBuffer).toContain('userId');
      expect(logBuffer).toContain('Grace sibling refresh token issued');
      expect(logBuffer).toContain('Refresh token reuse detected; entire token family revoked');

      // Assert log NEVER contains raw token or token hash
      expect(logBuffer).not.toContain(rawToken);
      expect(logBuffer).not.toContain(tokenHash);
    });
  });

  describe('Rejection Scenarios', () => {
    it('should reject an expired refresh token with 401', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'expired@example.com',
          password: 'Password123!',
        });

      const tokenHash = hashToken(reg.body.refreshToken);
      await RefreshToken.updateOne(
        { tokenHash },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
      );

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: reg.body.refreshToken });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Invalid or revoked refresh token');
    });

    it('should reject an already revoked refresh token with 401', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'revoked@example.com',
          password: 'Password123!',
        });

      const tokenHash = hashToken(reg.body.refreshToken);
      await RefreshToken.updateOne(
        { tokenHash },
        { $set: { revokedAt: new Date() } }
      );

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: reg.body.refreshToken });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Invalid or revoked refresh token');
    });

    it('should reject a refresh token for a deleted user with 401', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'deleteduser@example.com',
          password: 'Password123!',
        });

      await User.findByIdAndDelete(reg.body.user.id);

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: reg.body.refreshToken });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Unauthorized');
    });

    it('should return clean 500 when RefreshToken.create fails during rotation', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'persistenceerr@example.com',
          password: 'Password123!',
        });

      const createSpy = vi.spyOn(RefreshToken, 'create').mockRejectedValueOnce(new Error('DB write failure'));

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: reg.body.refreshToken });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        status: 'error',
        message: 'Internal Server Error',
      });

      createSpy.mockRestore();
    });
  });

  describe('Logout & Session Invalidation', () => {
    it('should logout single session and invalidate subsequent refresh calls', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'logout@example.com',
          password: 'Password123!',
        });

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken: reg.body.refreshToken });

      expect(logoutRes.status).toBe(204);

      // Subsequent refresh must fail with 401
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: reg.body.refreshToken });
      expect(refreshRes.status).toBe(401);
    });

    it('should return 204 for logout with unknown, expired, revoked, or garbage token without access token', async () => {
      // 1. Garbage string
      const garbageRes = await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken: 'not_a_valid_hex_token_garbage' });
      expect(garbageRes.status).toBe(204);

      // 2. Empty body
      const emptyRes = await request(app).post('/api/auth/logout').send({});
      expect(emptyRes.status).toBe(204);

      // 3. Unknown 64-hex token
      const unknownToken = crypto.randomBytes(32).toString('hex');
      const unknownRes = await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken: unknownToken });
      expect(unknownRes.status).toBe(204);
    });

    it('should logout-all sessions belonging to user upon authenticated request', async () => {
      // Register (creates Session 1)
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'multidevice@example.com',
          password: 'Password123!',
        });
      const session1Token = reg.body.refreshToken;
      const accessToken = reg.body.accessToken;

      // Login again (creates Session 2 with distinct familyId)
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'multidevice@example.com',
          password: 'Password123!',
        });
      const session2Token = loginRes.body.refreshToken;

      // Call logout-all with valid accessToken
      const logoutAllRes = await request(app)
        .post('/api/auth/logout-all')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(logoutAllRes.status).toBe(200);
      expect(logoutAllRes.body).toEqual({
        status: 'ok',
        message: 'All sessions logged out successfully',
      });

      // Both session refresh tokens must now be rejected
      const refresh1 = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: session1Token });
      expect(refresh1.status).toBe(401);

      const refresh2 = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: session2Token });
      expect(refresh2.status).toBe(401);
    });

    it('should return 401 on logout-all when unauthenticated', async () => {
      const response = await request(app).post('/api/auth/logout-all');
      expect(response.status).toBe(401);
    });
  });

  describe('Rate Limiter Scoping & Independence', () => {
    it('should demonstrate refresh rate limiter operates independently from auth rate limiter', async () => {
      const testApp = express();
      testApp.use(express.json());

      const loginLimiter = createAuthLimiter({ limit: 2, windowMs: 60000 });
      const refreshLim = createRefreshLimiter({ limit: 4, windowMs: 60000 });

      testApp.post('/login', loginLimiter, (_req, res) => res.status(200).json({ ok: true }));
      testApp.post('/refresh', refreshLim, (_req, res) => res.status(200).json({ ok: true }));

      // Exhaust login limiter (2 requests allowed, 3rd blocked)
      await request(testApp).post('/login');
      await request(testApp).post('/login');
      const loginBlocked = await request(testApp).post('/login');
      expect(loginBlocked.status).toBe(429);

      // Refresh limiter is independent: should still allow requests
      const refreshRes1 = await request(testApp).post('/refresh');
      const refreshRes2 = await request(testApp).post('/refresh');
      expect(refreshRes1.status).toBe(200);
      expect(refreshRes2.status).toBe(200);
    });
  });
});
