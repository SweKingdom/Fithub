import { describe, expect, it } from 'vitest';
import { clubDateKey, clubLocalToUtc, formatClubDay, formatClubTime } from '../src/lib/time';

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

describe('clubLocalToUtc', () => {
  it('converts winter time (UTC+1) to UTC', () => {
    expect(clubLocalToUtc('2026-11-02', '18:00', STOCKHOLM)).toBe('2026-11-02T17:00:00.000Z');
  });

  it('converts summer time (UTC+2) to UTC', () => {
    expect(clubLocalToUtc('2026-07-02', '18:00', STOCKHOLM)).toBe('2026-07-02T16:00:00.000Z');
  });

  it('uses the right offset on the day the clocks change (2026-10-25)', () => {
    // 02:30 is ambiguous that night; 12:00 is already winter time (UTC+1).
    expect(clubLocalToUtc('2026-10-25', '12:00', STOCKHOLM)).toBe('2026-10-25T11:00:00.000Z');
    expect(clubLocalToUtc('2026-10-25', '01:30', STOCKHOLM)).toBe('2026-10-24T23:30:00.000Z');
  });

  it('supports other time zones', () => {
    expect(clubLocalToUtc('2026-11-02', '18:00', 'UTC')).toBe('2026-11-02T18:00:00.000Z');
  });

  it.each([
    ['', '18:00'],
    ['2026-11-02', ''],
    ['02/11/2026', '18:00'],
    ['2026-13-45', '18:00'],
  ])('rejects invalid input (%s, %s)', (date, time) => {
    expect(() => clubLocalToUtc(date, time, STOCKHOLM)).toThrow(RangeError);
  });
});
