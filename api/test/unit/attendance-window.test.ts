import { describe, expect, it } from 'vitest';
import { attendanceWindow, canEditAttendance } from '../../src/modules/attendance/window.js';

const START = new Date('2026-10-30T09:00:00.000Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const gymClass = { start_at: START, duration_minutes: 60 };
const at = (offsetMs: number): Date => new Date(START.getTime() + offsetMs);

describe('attendanceWindow (US-129)', () => {
  it('opens at the class start and closes at class end + the edit window', () => {
    const window = attendanceWindow(gymClass, START, 24);
    expect(window.opensAt.toISOString()).toBe('2026-10-30T09:00:00.000Z');
    expect(window.closesAt.toISOString()).toBe('2026-10-31T10:00:00.000Z');
  });

  it('is not_open until the exact start', () => {
    expect(attendanceWindow(gymClass, at(-1), 24).state).toBe('not_open');
    expect(attendanceWindow(gymClass, at(-HOUR), 24).state).toBe('not_open');
  });

  it('is open from the exact start', () => {
    expect(attendanceWindow(gymClass, START, 24).state).toBe('open');
    expect(attendanceWindow(gymClass, at(10 * MIN), 24).state).toBe('open');
  });

  it('is open one millisecond before closesAt and closed exactly at closesAt', () => {
    const closesAt = 60 * MIN + 24 * HOUR;
    expect(attendanceWindow(gymClass, at(closesAt - 1), 24).state).toBe('open');
    expect(attendanceWindow(gymClass, at(closesAt), 24).state).toBe('closed');
    expect(attendanceWindow(gymClass, at(closesAt + 5 * HOUR), 24).state).toBe('closed');
  });

  it('follows the configured edit window and the class duration', () => {
    const window = attendanceWindow({ start_at: START, duration_minutes: 90 }, START, 2);
    expect(window.closesAt.getTime()).toBe(START.getTime() + 90 * MIN + 2 * HOUR);
  });
});

describe('canEditAttendance (US-129)', () => {
  it.each([
    ['instructor', 'not_open', false],
    ['club_manager', 'not_open', false],
    ['instructor', 'open', true],
    ['club_manager', 'open', true],
    ['instructor', 'closed', false],
    ['club_manager', 'closed', true],
    ['member', 'open', false],
    ['member', 'closed', false],
  ] as const)('%s in a %s window → %s', (role, state, expected) => {
    expect(canEditAttendance({ role }, { state })).toBe(expected);
  });
});
