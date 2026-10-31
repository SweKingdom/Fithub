import { describe, expect, it } from 'vitest';
import { getDummyHash, hashPassword, verifyPassword } from '../../src/modules/auth/password.js';

const COST = 16384;

describe('password hashing (US-118 AC 9)', () => {
  it('stores scrypt$N$r$p$salt$key with the parameters in the string', async () => {
    const hash = await hashPassword('correct-horse-battery', COST);
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/);
    expect(hash).not.toContain('correct-horse-battery');
  });

  it('uses a new random salt every time', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password-12', COST), hashPassword('same-password-12', COST)]);
    expect(a).not.toBe(b);
  });

  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct-horse-battery', COST);
    await expect(verifyPassword('correct-horse-battery', hash)).resolves.toBe(true);
    await expect(verifyPassword('correct-horse-batterz', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('reads the cost from the stored hash', async () => {
    const hash = await hashPassword('correct-horse-battery', 32768);
    await expect(verifyPassword('correct-horse-battery', hash)).resolves.toBe(true);
  });

  it.each([
    ['empty string', ''],
    ['no parameters', 'scrypt$'],
    ['another algorithm', 'bcrypt$16384$8$1$c2FsdA==$a2V5'],
    ['non-numeric cost', 'scrypt$abc$8$1$c2FsdA==$a2V5'],
    ['cost that is not a power of two', 'scrypt$16383$8$1$c2FsdA==$a2V5'],
    ['cost far above the limit', 'scrypt$1073741824$8$1$c2FsdA==$a2V5'],
    ['zero block size', 'scrypt$16384$0$1$c2FsdA==$a2V5'],
    ['empty salt', 'scrypt$16384$8$1$$a2V5'],
    ['empty key', 'scrypt$16384$8$1$c2FsdA==$'],
    ['too many parts', 'scrypt$16384$8$1$c2FsdA==$a2V5$extra'],
  ])('returns false for a malformed hash: %s', async (_name, stored) => {
    await expect(verifyPassword('correct-horse-battery', stored)).resolves.toBe(false);
  });

  it('provides one valid dummy hash per cost, computed once', async () => {
    const first = getDummyHash(COST);
    expect(getDummyHash(COST)).toBe(first);
    expect(await first).toMatch(/^scrypt\$16384\$8\$1\$/);
    await expect(verifyPassword('anything-at-all', await first)).resolves.toBe(false);
  });
});
