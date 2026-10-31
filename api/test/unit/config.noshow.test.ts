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

describe('no-show block config (US-130 AC 5)', () => {
  it('uses the documented defaults', () => {
    expect(loadConfig({}).noShow).toEqual({
      threshold: 3,
      window: 'rolling_days',
      windowDays: 30,
      blockDays: 7,
    });
  });

  it('reads every variable', () => {
    const config = loadConfig({
      NO_SHOW_THRESHOLD: '4',
      NO_SHOW_WINDOW: 'calendar_month',
      NO_SHOW_WINDOW_DAYS: '60',
      NO_SHOW_BLOCK_DAYS: '3',
    });
    expect(config.noShow).toEqual({ threshold: 4, window: 'calendar_month', windowDays: 60, blockDays: 3 });
  });

  it('treats blank values as not set', () => {
    expect(loadConfig({ NO_SHOW_THRESHOLD: '  ' }).noShow.threshold).toBe(3);
  });

  it.each([
    ['NO_SHOW_THRESHOLD', '0', 'must be an integer between 1 and 20'],
    ['NO_SHOW_THRESHOLD', '21', 'must be an integer between 1 and 20'],
    ['NO_SHOW_THRESHOLD', 'three', 'must be an integer between 1 and 20'],
    ['NO_SHOW_WINDOW', 'weekly', 'must be one of rolling_days, calendar_month'],
    ['NO_SHOW_WINDOW_DAYS', '0', 'must be an integer between 1 and 366'],
    ['NO_SHOW_WINDOW_DAYS', '367', 'must be an integer between 1 and 366'],
    ['NO_SHOW_BLOCK_DAYS', '0', 'must be an integer between 1 and 90'],
    ['NO_SHOW_BLOCK_DAYS', '91', 'must be an integer between 1 and 90'],
    ['NO_SHOW_BLOCK_DAYS', '1.5', 'must be an integer between 1 and 90'],
  ])('rejects %s=%s', (name, value, reason) => {
    expect(messageOf({ [name]: value })).toBe(`Invalid configuration: ${name}: ${reason}`);
  });
});
