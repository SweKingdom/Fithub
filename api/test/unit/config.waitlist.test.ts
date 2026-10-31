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

describe('waiting-list and jobs config (US-128)', () => {
  it('uses the documented defaults', () => {
    const config = loadConfig({});
    expect(config.waitlist).toEqual({ promotionCutoffMinutes: 0, jobIntervalSeconds: 60 });
    expect(config.jobs).toEqual({ enabled: true });
  });

  it('turns jobs off by default under NODE_ENV=test, but JOBS_ENABLED wins', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).jobs.enabled).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test', JOBS_ENABLED: 'true' }).jobs.enabled).toBe(true);
    expect(loadConfig({ JOBS_ENABLED: 'false' }).jobs.enabled).toBe(false);
  });

  it('reads the cut-off and the job interval', () => {
    const config = loadConfig({ WAITLIST_PROMOTION_CUTOFF_MINUTES: '30', WAITLIST_JOB_INTERVAL_SECONDS: '10' });
    expect(config.waitlist).toEqual({ promotionCutoffMinutes: 30, jobIntervalSeconds: 10 });
  });

  it.each([
    ['WAITLIST_PROMOTION_CUTOFF_MINUTES', '-1', 'must be an integer of at least 0'],
    ['WAITLIST_PROMOTION_CUTOFF_MINUTES', 'soon', 'must be an integer of at least 0'],
    ['WAITLIST_JOB_INTERVAL_SECONDS', '9', 'must be an integer of at least 10'],
    ['WAITLIST_JOB_INTERVAL_SECONDS', '1.5', 'must be an integer of at least 10'],
    ['JOBS_ENABLED', 'yes', 'must be true or false'],
  ])('rejects %s=%s', (name, value, reason) => {
    expect(messageOf({ [name]: value })).toBe(`Invalid configuration: ${name}: ${reason}`);
  });
});
