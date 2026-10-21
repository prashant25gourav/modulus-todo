import jwt, { SignOptions, VerifyOptions } from 'jsonwebtoken';
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
    complete: false,
  };

  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, options);

  if (typeof decoded !== 'object' || !decoded || !('sub' in decoded)) {
    throw new Error('Invalid token payload');
  }

  return { sub: (decoded as { sub: string }).sub };
};
