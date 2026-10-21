import * as argon2 from 'argon2';
import { logger } from '../config/db';

/**
 * OWASP recommended parameters for Argon2id.
 */
export const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,       // 2 iterations
  parallelism: 1,    // 1 thread
};

// Compute dummy hash promise once at module load without hardcoded fallback
export const dummyHashPromise: Promise<string | null> = argon2
  .hash('__timing_enumeration_mitigation_token__', ARGON2_OPTIONS)
  .catch((err: unknown) => {
    const errName = err instanceof Error ? err.name : 'UnknownError';
    const errMessage = err instanceof Error ? err.message : String(err);
    logger.error({ errName, errMessage }, 'Argon2 dummy hash generation failed');
    return null;
  });

/**
 * Hashes a plaintext password using Argon2id.
 */
export const hashPassword = async (password: string): Promise<string> => {
  return argon2.hash(password, ARGON2_OPTIONS);
};

/**
 * Verifies a plaintext password against an Argon2id hash.
 */
export const verifyPassword = async (hash: string, password: string): Promise<boolean> => {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
};

/**
 * Runs a dummy verification against the startup dummy hash to equalize timing when a user does not exist.
 */
export const dummyVerifyPassword = async (password: string): Promise<boolean> => {
  try {
    const hash = await dummyHashPromise;
    if (!hash) {
      return false;
    }
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
};
