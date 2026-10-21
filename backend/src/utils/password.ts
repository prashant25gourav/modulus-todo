import * as argon2 from 'argon2';

/**
 * OWASP recommended parameters for Argon2id.
 */
export const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,       // 2 iterations
  parallelism: 1,    // 1 thread
};

// Constant dummy hash fallback
let dummyHash = '$argon2id$v=19$m=19456,t=2,p=1$7v1bBqXy98/L4r5nJ9K8gA$R1e2W3q4E5r6T7y8U9i0O1p2A3s4D5f6G7h8J9k0L1z';

// Pre-compute live hash on module load
void argon2.hash('__timing_enumeration_mitigation_token__', ARGON2_OPTIONS).then((hash: string) => {
  dummyHash = hash;
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
    return await argon2.verify(dummyHash, password);
  } catch {
    return false;
  }
};
