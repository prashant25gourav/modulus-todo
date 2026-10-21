import jwt, { SignOptions, VerifyOptions } from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env';

export const JWT_ISSUER = 'modulus-todo-api';
export const JWT_AUDIENCE = 'modulus-todo-app';

export interface TokenPayload {
  sub: string;
}

/**
 * Sign an access token with algorithm pinned to HS256.
 * Payload carries sub (user ID) only - no PII.
 */
export const signAccessToken = (userId: string): string => {
  if (!mongoose.isValidObjectId(userId) || !/^[0-9a-fA-F]{24}$/.test(userId)) {
    throw new Error('Invalid user ID for JWT signing');
  }

  const options: SignOptions = {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
  };

  return jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, options);
};

/**
 * Verify an access token with algorithm pinned to HS256, requiring exp, issuer, and audience.
 */
export const verifyAccessToken = (token: string): TokenPayload => {
  const options: VerifyOptions = {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  };

  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, options);

  if (typeof decoded !== 'object' || !decoded) {
    throw new Error('Invalid token payload');
  }

  const payload = decoded as { sub?: unknown; exp?: unknown };

  if (typeof payload.exp !== 'number') {
    throw new Error('Token missing required expiration');
  }

  if (
    typeof payload.sub !== 'string' ||
    !/^[0-9a-fA-F]{24}$/.test(payload.sub) ||
    !mongoose.isValidObjectId(payload.sub)
  ) {
    throw new Error('Token subject must be a valid 24-character hex ObjectId');
  }

  return { sub: payload.sub };
};
