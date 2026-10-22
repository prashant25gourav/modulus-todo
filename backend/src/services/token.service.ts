import crypto from 'crypto';
import { Types } from 'mongoose';
import pino from 'pino';
import { RefreshToken } from '../models/refresh-token.model';
import { User } from '../models/user.model';
import { env } from '../config/env';
import { signAccessToken } from '../utils/jwt';
import { generateOpaqueToken, hashToken } from '../utils/token';

export const tokenLogger = pino({
  name: 'token-service',
  level: process.env.NODE_ENV === 'test' && !process.env.TEST_LOGS ? 'silent' : 'info',
});

let activeLogger = tokenLogger;

/**
 * Configure custom logger for testing log outputs.
 */
export const setTokenLogger = (logger: pino.Logger): void => {
  activeLogger = logger;
};

export const resetTokenLogger = (): void => {
  activeLogger = tokenLogger;
};

export class TokenPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenPersistenceError';
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Helper to issue a new access token and a persisted refresh token pair.
 * Shared across register, login, fresh-rotation, and grace-sibling flows.
 */
export const issueTokenPair = async (
  userId: Types.ObjectId | string,
  familyId?: string
): Promise<TokenPair> => {
  const resolvedFamilyId = familyId || crypto.randomUUID();
  const rawRefreshToken = generateOpaqueToken();
  const tokenHash = hashToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  try {
    await RefreshToken.create({
      tokenHash,
      userId: new Types.ObjectId(userId.toString()),
      familyId: resolvedFamilyId,
      expiresAt,
    });
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    activeLogger.error({ errMessage }, 'Failed to persist refresh token');
    throw new TokenPersistenceError('Failed to persist refresh token');
  }

  const accessToken = signAccessToken(userId.toString());

  return {
    accessToken,
    refreshToken: rawRefreshToken,
  };
};

export type RotateResult =
  | { success: true; accessToken: string; refreshToken: string }
  | { success: false; status: 401 | 500; message: string };

/**
 * Rotate refresh token with grace window concurrent replay handling and reuse breach detection.
 */
export const rotateRefreshToken = async (rawRefreshToken: string): Promise<RotateResult> => {
  const tokenHash = hashToken(rawRefreshToken);

  // 1. Fresh rotation: atomic CAS from unused (usedAt: null) to used (usedAt: now)
  const freshToken = await RefreshToken.findOneAndUpdate(
    {
      tokenHash,
      usedAt: null,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { usedAt: new Date() } },
    { new: true }
  );

  if (freshToken) {
    const userExists = await User.exists({ _id: freshToken.userId });
    if (!userExists) {
      return { success: false, status: 401, message: 'Unauthorized' };
    }

    try {
      const tokens = await issueTokenPair(freshToken.userId, freshToken.familyId);
      return { success: true, ...tokens };
    } catch {
      return { success: false, status: 500, message: 'Internal Server Error' };
    }
  }

  // 2. Token was not fresh: check record status
  const existingToken = await RefreshToken.findOne({ tokenHash });

  // Unknown, expired, or already revoked
  if (!existingToken || existingToken.revokedAt !== null || existingToken.expiresAt <= new Date()) {
    return { success: false, status: 401, message: 'Invalid or revoked refresh token' };
  }

  // 3. Token was already used: evaluate the grace window
  if (existingToken.usedAt !== null) {
    const graceCutoff = new Date(Date.now() - env.REFRESH_GRACE_SECONDS * 1000);

    // If within grace window, attempt atomic single-sibling issuance
    if (existingToken.usedAt >= graceCutoff) {
      const graceToken = await RefreshToken.findOneAndUpdate(
        {
          _id: existingToken._id,
          usedAt: { $gte: graceCutoff },
          graceIssuedAt: null,
          revokedAt: null,
        },
        { $set: { graceIssuedAt: new Date() } },
        { new: true }
      );

      if (graceToken) {
        // Log grace issuance at info level without tokens or hashes
        activeLogger.info(
          {
            userId: graceToken.userId.toString(),
            familyId: graceToken.familyId,
          },
          'Grace sibling refresh token issued'
        );

        const userExists = await User.exists({ _id: graceToken.userId });
        if (!userExists) {
          return { success: false, status: 401, message: 'Unauthorized' };
        }

        try {
          const tokens = await issueTokenPair(graceToken.userId, graceToken.familyId);
          return { success: true, ...tokens };
        } catch {
          return { success: false, status: 500, message: 'Internal Server Error' };
        }
      }
    }

    // 4. Any further reuse (second replay within window) or reuse after window:
    // Log family revocation at warn (fields: userId, familyId only, never tokens or hashes)
    activeLogger.warn(
      {
        userId: existingToken.userId.toString(),
        familyId: existingToken.familyId,
      },
      'Refresh token reuse detected; entire token family revoked'
    );

    // Revoke the entire family
    await RefreshToken.updateMany(
      { familyId: existingToken.familyId },
      { $set: { revokedAt: new Date() } }
    );

    return { success: false, status: 401, message: 'Invalid or revoked refresh token' };
  }

  return { success: false, status: 401, message: 'Invalid or revoked refresh token' };
};

/**
 * Revoke a single refresh token or family. Idempotent.
 */
export const revokeToken = async (rawRefreshToken: string): Promise<void> => {
  const tokenHash = hashToken(rawRefreshToken);
  await RefreshToken.updateMany(
    { tokenHash },
    { $set: { revokedAt: new Date() } }
  );
};

/**
 * Revoke all active refresh tokens belonging to a user.
 */
export const revokeAllUserTokens = async (userId: Types.ObjectId | string): Promise<void> => {
  await RefreshToken.updateMany(
    { userId: new Types.ObjectId(userId.toString()) },
    { $set: { revokedAt: new Date() } }
  );
};
