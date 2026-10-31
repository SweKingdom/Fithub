import { describe, expect, it } from 'vitest';
import { formatClubSeedSummary } from '../../src/modules/clubs/seed.js';

describe('club seed summary (US-117)', () => {
  it('prints the counts in the documented one-line format', () => {
    expect(formatClubSeedSummary({ inserted: 1, updated: 2, unchanged: 3, warnings: ['ignored'] })).toBe(
      'Clubs seeded: 1 inserted, 2 updated, 3 unchanged.',
    );
  });
});
