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

const production = { NODE_ENV: 'production', APP_ORIGIN: 'https://fithub.example.com' };

describe('auth config (US-118)', () => {
  it('uses the documented defaults for an empty environment', () => {
    expect(loadConfig({}).auth).toEqual({
      appOrigin: 'http://localhost:5173',
      sessionCookieSecure: false,
      sessionIdleTimeoutMinutes: 720,
      sessionMaxAgeHours: 168,
      scryptCost: 131072,
      loginRateLimitMax: 10,
      loginRateLimitWindowMinutes: 15,
      trustProxy: false,
    });
  });

  it('defaults the secure cookie to true in production', () => {
    expect(loadConfig(production).auth.sessionCookieSecure).toBe(true);
  });

  it('requires APP_ORIGIN in production', () => {
    expect(messageOf({ NODE_ENV: 'production' })).toBe(
      'Invalid configuration: APP_ORIGIN: required when NODE_ENV=production',
    );
  });

  it('refuses an insecure session cookie in production', () => {
    expect(messageOf({ ...production, SESSION_COOKIE_SECURE: 'false' })).toBe(
      'Invalid configuration: SESSION_COOKIE_SECURE: must be true when NODE_ENV=production',
    );
  });

  it('accepts overrides', () => {
    const { auth } = loadConfig({
      APP_ORIGIN: 'https://app.example.com',
      SESSION_COOKIE_SECURE: 'true',
      SESSION_IDLE_TIMEOUT_MINUTES: '5',
      SESSION_MAX_AGE_HOURS: '1',
      AUTH_SCRYPT_COST: '16384',
      LOGIN_RATE_LIMIT_MAX: '3',
      LOGIN_RATE_LIMIT_WINDOW_MINUTES: '1',
      TRUST_PROXY: 'true',
    });
    expect(auth).toEqual({
      appOrigin: 'https://app.example.com',
      sessionCookieSecure: true,
      sessionIdleTimeoutMinutes: 5,
      sessionMaxAgeHours: 1,
      scryptCost: 16384,
      loginRateLimitMax: 3,
      loginRateLimitWindowMinutes: 1,
      trustProxy: true,
    });
  });

  it.each([
    ['APP_ORIGIN', 'fithub.example.com', 'must be an origin such as https://app.example.com (no path, no trailing slash)'],
    ['APP_ORIGIN', 'https://app.example.com/', 'must be an origin such as https://app.example.com (no path, no trailing slash)'],
    ['SESSION_COOKIE_SECURE', 'yes', 'must be true or false'],
    ['TRUST_PROXY', '1', 'must be true or false'],
    ['SESSION_IDLE_TIMEOUT_MINUTES', '4', 'must be an integer of at least 5'],
    ['SESSION_MAX_AGE_HOURS', '0', 'must be an integer of at least 1'],
    ['LOGIN_RATE_LIMIT_MAX', 'many', 'must be an integer of at least 1'],
    ['LOGIN_RATE_LIMIT_WINDOW_MINUTES', '0', 'must be an integer of at least 1'],
    ['AUTH_SCRYPT_COST', '8192', 'must be a power of two of at least 16384'],
    ['AUTH_SCRYPT_COST', '20000', 'must be a power of two of at least 16384'],
  ])('rejects %s=%s', (variable, value, reason) => {
    expect(messageOf({ [variable]: value })).toBe(`Invalid configuration: ${variable}: ${reason}`);
  });

  it('reports auth and payment problems together', () => {
    const message = messageOf({ PAYMENTS_ENABLED: 'yes', SESSION_MAX_AGE_HOURS: '0' });
    expect(message).toContain('PAYMENTS_ENABLED: must be true or false');
    expect(message).toContain('SESSION_MAX_AGE_HOURS: must be an integer of at least 1');
  });
});
