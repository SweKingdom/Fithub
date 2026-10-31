import { describe, expect, it } from 'vitest';
import { normalizeEmail, normalizeLookupKey, normalizeName } from '../../../src/modules/imports/normalize.js';

describe('import normalisation (US-135)', () => {
  it('normalizeEmail trims and lower-cases', () => {
    expect(normalizeEmail('  Anna@X.se ')).toBe('anna@x.se');
  });

  it('normalizeName trims and collapses whitespace runs to one space', () => {
    expect(normalizeName('  Anna \t  Lind\n Berg ')).toBe('Anna Lind Berg');
  });

  it('normalizeName keeps letter case', () => {
    expect(normalizeName('Anna LIND')).toBe('Anna LIND');
  });

  it('normalizeLookupKey trims and lower-cases', () => {
    expect(normalizeLookupKey(' Drop-In ')).toBe('drop-in');
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeEmail('   ')).toBe('');
    expect(normalizeName('   ')).toBe('');
  });
});
