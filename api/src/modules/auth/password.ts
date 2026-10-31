import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const PREFIX = 'scrypt';
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
// Bounds for the parameters read from a stored hash, so a corrupt value cannot exhaust memory.
const MAX_COST = 2 ** 20;
const MAX_BLOCK_SIZE = 32;
const MAX_PARALLELISM = 16;

function deriveKey(
  plain: string,
  salt: Buffer,
  keyLength: number,
  cost: number,
  blockSize: number,
  parallelism: number,
): Promise<Buffer> {
  const options: ScryptOptions = {
    N: cost,
    r: blockSize,
    p: parallelism,
    maxmem: 256 * cost * blockSize,
  };
  return new Promise((resolve, reject) => {
    scrypt(plain, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** `scrypt$<N>$<r>$<p>$<salt b64>$<key b64>`. The parameters travel with the hash so the cost can be raised later. */
export async function hashPassword(plain: string, cost: number): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(plain, salt, KEY_BYTES, cost, BLOCK_SIZE, PARALLELISM);
  return [PREFIX, cost, BLOCK_SIZE, PARALLELISM, salt.toString('base64'), key.toString('base64')].join('$');
}

function parseParameter(value: string, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= max ? parsed : null;
}

/** Constant-time check. A malformed stored hash never matches. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const cost = parseParameter(parts[1], MAX_COST);
  const blockSize = parseParameter(parts[2], MAX_BLOCK_SIZE);
  const parallelism = parseParameter(parts[3], MAX_PARALLELISM);
  if (cost === null || blockSize === null || parallelism === null) return false;
  if ((cost & (cost - 1)) !== 0 || cost < 2) return false;

  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await deriveKey(plain, salt, expected.length, cost, blockSize, parallelism);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const dummyHashes = new Map<number, Promise<string>>();

/**
 * A valid hash of a random password, computed once per cost. Checking against it for an unknown email
 * makes that case take as long as a wrong password.
 */
export function getDummyHash(cost: number): Promise<string> {
  let hash = dummyHashes.get(cost);
  if (hash === undefined) {
    hash = hashPassword(randomBytes(16).toString('hex'), cost);
    dummyHashes.set(cost, hash);
  }
  return hash;
}
