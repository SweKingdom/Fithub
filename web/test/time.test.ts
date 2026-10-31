import { describe, expect, it } from 'vitest';
import { clubDateKey, formatClubDay, formatClubTime } from '../src/lib/time';

const STOCKHOLM = 'Europe/Stockholm';

describe('club time helpers (AC 8)', () => {
  it('moves a late UTC class to the next local day', () => {
    const iso = '2026-11-02T23:30:00Z';
    expect(formatClubTime(iso, STOCKHOLM)).toBe('00:30');
    expect(clubDateKey(iso, STOCKHOLM)).toBe('2026-11-03');
    expect(formatClubDay(iso, STOCKHOLM)).toBe('Tuesday 3 November');
  });

  it('uses the offset before and after the DST change on 2026-10-25', () => {
    expect(formatClubTime('2026-10-25T00:30:00Z', STOCKHOLM)).toBe('02:30'); // CEST (UTC+2)
    expect(formatClubTime('2026-10-25T02:30:00Z', STOCKHOLM)).toBe('03:30'); // CET (UTC+1)
    expect(clubDateKey('2026-10-25T02:30:00Z', STOCKHOLM)).toBe('2026-10-25');
  });

  it('follows the given time zone, not the browser', () => {
    expect(formatClubTime('2026-11-02T23:30:00Z', 'UTC')).toBe('23:30');
    expect(clubDateKey('2026-11-02T23:30:00Z', 'UTC')).toBe('2026-11-02');
  });
});
