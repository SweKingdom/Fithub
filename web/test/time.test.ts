import { describe, expect, it } from 'vitest';
import { clubLocalToUtc } from '../src/lib/time';

describe('clubLocalToUtc', () => {
  it('converts winter time (UTC+1) to UTC', () => {
    expect(clubLocalToUtc('2026-11-02', '18:00', 'Europe/Stockholm')).toBe('2026-11-02T17:00:00.000Z');
  });

  it('converts summer time (UTC+2) to UTC', () => {
    expect(clubLocalToUtc('2026-07-02', '18:00', 'Europe/Stockholm')).toBe('2026-07-02T16:00:00.000Z');
  });

  it('uses the right offset on the day the clocks change (2026-10-25)', () => {
    // 02:30 is ambiguous that night; 12:00 is already winter time (UTC+1).
    expect(clubLocalToUtc('2026-10-25', '12:00', 'Europe/Stockholm')).toBe('2026-10-25T11:00:00.000Z');
    expect(clubLocalToUtc('2026-10-25', '01:30', 'Europe/Stockholm')).toBe('2026-10-24T23:30:00.000Z');
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
    expect(() => clubLocalToUtc(date, time, 'Europe/Stockholm')).toThrow(RangeError);
  });
});
