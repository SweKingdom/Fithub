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

describe('waiting-list config (US-127, AC 6)', () => {
  it('defaults the promotion cut-off to 0 (class start)', () => {
    expect(loadConfig({}).waitlist).toEqual({ promotionCutoffMinutes: 0 });
  });

  it('treats a blank value as not set', () => {
    expect(loadConfig({ WAITLIST_PROMOTION_CUTOFF_MINUTES: '  ' }).waitlist.promotionCutoffMinutes).toBe(0);
  });

  it('reads a positive cut-off', () => {
    expect(loadConfig({ WAITLIST_PROMOTION_CUTOFF_MINUTES: '30' }).waitlist.promotionCutoffMinutes).toBe(30);
  });

  it('accepts an explicit 0', () => {
    expect(loadConfig({ WAITLIST_PROMOTION_CUTOFF_MINUTES: '0' }).waitlist.promotionCutoffMinutes).toBe(0);
  });

  it.each(['-1', '1.5', 'soon', '99999999999999999999'])('rejects WAITLIST_PROMOTION_CUTOFF_MINUTES=%s', (value) => {
    expect(messageOf({ WAITLIST_PROMOTION_CUTOFF_MINUTES: value })).toBe(
      'Invalid configuration: WAITLIST_PROMOTION_CUTOFF_MINUTES: must be a whole number of minutes, 0 or more',
    );
  });

  it('validates the cut-off while payments are switched off', () => {
    expect(messageOf({ PAYMENTS_ENABLED: 'false', WAITLIST_PROMOTION_CUTOFF_MINUTES: '-5' })).toContain(
      'WAITLIST_PROMOTION_CUTOFF_MINUTES',
    );
  });

  it('reports the cut-off together with payment problems', () => {
    const message = messageOf({ PAYMENTS_ENABLED: 'true', WAITLIST_PROMOTION_CUTOFF_MINUTES: 'x' });
    expect(message).toContain('WAITLIST_PROMOTION_CUTOFF_MINUTES: must be a whole number');
    expect(message).toContain('STRIPE_SECRET_KEY: required when PAYMENTS_ENABLED=true');
  });
});
