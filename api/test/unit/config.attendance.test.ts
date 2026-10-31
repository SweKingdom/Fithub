import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

function messageOf(env: NodeJS.ProcessEnv): string {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error('expected loadConfig to throw');
}

describe('attendance config (US-129)', () => {
  it('uses the documented defaults: 24 h window, auto no-show off, sweep every 15 minutes', () => {
    expect(loadConfig({}).attendance).toEqual({
      editWindowHours: 24,
      autoNoShowEnabled: false,
      sweepIntervalMinutes: 15,
    });
  });

  it('reads valid values', () => {
    expect(
      loadConfig({
        ATTENDANCE_EDIT_WINDOW_HOURS: '48',
        ATTENDANCE_AUTO_NO_SHOW_ENABLED: 'true',
        ATTENDANCE_SWEEP_INTERVAL_MINUTES: '5',
      }).attendance,
    ).toEqual({ editWindowHours: 48, autoNoShowEnabled: true, sweepIntervalMinutes: 5 });
  });

  it('accepts the limits of the ranges', () => {
    expect(loadConfig({ ATTENDANCE_EDIT_WINDOW_HOURS: '1' }).attendance.editWindowHours).toBe(1);
    expect(loadConfig({ ATTENDANCE_EDIT_WINDOW_HOURS: '168' }).attendance.editWindowHours).toBe(168);
    expect(loadConfig({ ATTENDANCE_SWEEP_INTERVAL_MINUTES: '1440' }).attendance.sweepIntervalMinutes).toBe(1440);
  });

  it.each([
    ['ATTENDANCE_EDIT_WINDOW_HOURS', '0', 'must be an integer between 1 and 168'],
    ['ATTENDANCE_EDIT_WINDOW_HOURS', '169', 'must be an integer between 1 and 168'],
    ['ATTENDANCE_EDIT_WINDOW_HOURS', 'day', 'must be an integer between 1 and 168'],
    ['ATTENDANCE_SWEEP_INTERVAL_MINUTES', '0', 'must be an integer between 1 and 1440'],
    ['ATTENDANCE_SWEEP_INTERVAL_MINUTES', '1441', 'must be an integer between 1 and 1440'],
    ['ATTENDANCE_AUTO_NO_SHOW_ENABLED', 'yes', 'must be true or false'],
  ])('rejects %s=%s', (variable, value, reason) => {
    expect(messageOf({ [variable]: value })).toBe(`Invalid configuration: ${variable}: ${reason}`);
  });
});
