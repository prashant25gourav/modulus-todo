import crypto from 'crypto';

/**
 * Generates a cryptographically secure opaque token (32 bytes = 64 hex characters).
 */
export const generateOpaqueToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Computes the SHA-256 hex digest of a token string.
 * Used to store only token hashes in the database.
 */
export const hashToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};
