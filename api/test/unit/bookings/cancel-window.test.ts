import { describe, expect, it } from 'vitest';
import { cancelDeadline, formatCutoff, isWithinCancelWindow } from '../../../src/modules/bookings/cancel-window.js';

const startAt = new Date('2026-11-02T18:00:00.000Z');
const minutesBefore = (minutes: number, seconds = 0): Date =>
  new Date(startAt.getTime() - minutes * 60_000 - seconds * 1000);

describe('cancelDeadline', () => {
  it('is the start minus the cut-off', () => {
    expect(cancelDeadline(startAt, 120).toISOString()).toBe('2026-11-02T16:00:00.000Z');
    expect(cancelDeadline(startAt, 90).toISOString()).toBe('2026-11-02T16:30:00.000Z');
  });

  it('is the start itself for a cut-off of 0', () => {
    expect(cancelDeadline(startAt, 0).getTime()).toBe(startAt.getTime());
  });

  it('does not change the start date', () => {
    cancelDeadline(startAt, 120);
    expect(startAt.toISOString()).toBe('2026-11-02T18:00:00.000Z');
  });
});

describe('AC 2: isWithinCancelWindow boundary', () => {
  it('accepts 3 hours before the start', () => {
    expect(isWithinCancelWindow(minutesBefore(180), startAt, 120)).toBe(true);
  });

  it('accepts exactly 120 minutes before the start', () => {
    expect(isWithinCancelWindow(minutesBefore(120), startAt, 120)).toBe(true);
  });

  it('rejects 119 minutes 59 seconds before the start', () => {
    expect(isWithinCancelWindow(minutesBefore(119, 59), startAt, 120)).toBe(false);
  });

  it('rejects 1 hour before and after the start', () => {
    expect(isWithinCancelWindow(minutesBefore(60), startAt, 120)).toBe(false);
    expect(isWithinCancelWindow(new Date(startAt.getTime() + 3_600_000), startAt, 120)).toBe(false);
  });
});

describe('AC 8: isWithinCancelWindow with a configured cut-off', () => {
  it('accepts 100 minutes before the start with a cut-off of 90', () => {
    expect(isWithinCancelWindow(minutesBefore(100), startAt, 90)).toBe(true);
  });

  it('rejects 89 minutes before the start with a cut-off of 90', () => {
    expect(isWithinCancelWindow(minutesBefore(89), startAt, 90)).toBe(false);
  });

  it('allows cancelling right up to the start with a cut-off of 0', () => {
    expect(isWithinCancelWindow(startAt, startAt, 0)).toBe(true);
    expect(isWithinCancelWindow(new Date(startAt.getTime() + 1), startAt, 0)).toBe(false);
  });
});

describe('formatCutoff', () => {
  it.each([
    [120, '2 hours'],
    [60, '1 hour'],
    [90, '90 minutes'],
    [0, '0 minutes'],
    [1, '1 minute'],
    [1440, '24 hours'],
  ])('formats %i minutes as "%s"', (minutes, expected) => {
    expect(formatCutoff(minutes)).toBe(expected);
  });
});
