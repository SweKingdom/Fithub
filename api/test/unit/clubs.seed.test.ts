import { describe, expect, it } from 'vitest';
import { ClubSeedError, parseClubSeed } from '../../src/modules/clubs/seed.js';

describe('club seed file (US-117)', () => {
  it('accepts clubs and normalises code (upper case) and trims name', () => {
    expect(parseClubSeed([{ code: ' city-1 ', name: ' FitHub City ', timezone: 'Europe/Stockholm' }])).toEqual([
      { code: 'CITY-1', name: 'FitHub City', timezone: 'Europe/Stockholm' },
    ]);
  });

  it.each([
    ['an empty list', [], /at least one club/],
    ['a missing name', [{ code: 'A', timezone: 'Europe/Stockholm' }], /0\.name/],
    ['an empty code', [{ code: ' ', name: 'A', timezone: 'Europe/Stockholm' }], /0\.code/],
    ['an unknown time zone', [{ code: 'A', name: 'A', timezone: 'Mars/Base' }], /IANA time zone/],
    ['not a list', { code: 'A' }, /Invalid club file/],
  ])('rejects %s', (_name, input, message) => {
    expect(() => parseClubSeed(input)).toThrow(ClubSeedError);
    expect(() => parseClubSeed(input)).toThrow(message);
  });

  it('rejects a code that appears twice, ignoring letter case', () => {
    const club = { name: 'A', timezone: 'Europe/Stockholm' };
    expect(() => parseClubSeed([{ ...club, code: 'a' }, { ...club, code: 'A' }])).toThrow(/appears twice/);
  });
});
