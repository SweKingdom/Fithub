import { describe, expect, it } from 'vitest';
import { noShowWindowStart } from '../../src/modules/attendance/no-show-window.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('noShowWindowStart (US-130 AC 7)', () => {
  describe('rolling_days', () => {
    it('starts windowDays before now and excludes the boundary', () => {
      const now = new Date('2026-10-30T09:00:00.000Z');
      const window = noShowWindowStart(now, { window: 'rolling_days', windowDays: 30 }, 'Europe/Stockholm');
      expect(window.from.toISOString()).toBe('2026-09-30T09:00:00.000Z');
      expect(window.inclusive).toBe(false);
    });

    it('uses the configured number of days and ignores the time zone', () => {
      const now = new Date('2026-10-30T09:00:00.000Z');
      const window = noShowWindowStart(now, { window: 'rolling_days', windowDays: 7 }, 'Pacific/Auckland');
      expect(window.from.getTime()).toBe(now.getTime() - 7 * DAY_MS);
    });
  });

  describe('calendar_month', () => {
    const config = { window: 'calendar_month', windowDays: 30 } as const;

    it('starts at 00:00 on the 1st in the club time zone (summer time), inclusive', () => {
      const window = noShowWindowStart(new Date('2026-10-02T10:00:00.000Z'), config, 'Europe/Stockholm');
      expect(window.from.toISOString()).toBe('2026-09-30T22:00:00.000Z');
      expect(window.inclusive).toBe(true);
    });

    it('uses the winter-time offset when the 1st is in winter time', () => {
      const window = noShowWindowStart(new Date('2026-11-15T12:00:00.000Z'), config, 'Europe/Stockholm');
      expect(window.from.toISOString()).toBe('2026-10-31T23:00:00.000Z');
    });

    it('uses the offset of the 1st, not of now, when the clock changed during the month', () => {
      // 1 March is CET (+01:00); 31 March is already CEST (+02:00).
      const window = noShowWindowStart(new Date('2026-03-31T12:00:00.000Z'), config, 'Europe/Stockholm');
      expect(window.from.toISOString()).toBe('2026-02-28T23:00:00.000Z');
    });

    it('moves to the next month when it is already the 1st in club time but still the 31st in UTC', () => {
      const window = noShowWindowStart(new Date('2026-10-31T23:30:00.000Z'), config, 'Europe/Stockholm');
      expect(window.from.toISOString()).toBe('2026-10-31T23:00:00.000Z');
    });

    it('stays in the previous month when it is still the last day there in club time', () => {
      const window = noShowWindowStart(new Date('2026-11-01T03:00:00.000Z'), config, 'America/New_York');
      expect(window.from.toISOString()).toBe('2026-10-01T04:00:00.000Z');
    });

    it('uses UTC midnight for a UTC club', () => {
      const window = noShowWindowStart(new Date('2026-10-15T08:00:00.000Z'), config, 'UTC');
      expect(window.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    });
  });
});
