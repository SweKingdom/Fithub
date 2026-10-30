import { describe, expect, it } from 'vitest';
import { ConfigError, describePayments, loadConfig } from '../../src/config.js';

const validEnv = {
  PAYMENTS_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_fake',
  DROP_IN_PRICE_AMOUNT: '1500',
  DROP_IN_CURRENCY: 'EUR',
};

function messageOf(env: NodeJS.ProcessEnv): string {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error('expected loadConfig to throw');
}

describe('payments config', () => {
  describe('AC 2: fails fast when payments are on', () => {
    it.each([
      'STRIPE_SECRET_KEY',
      'STRIPE_PUBLISHABLE_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'DROP_IN_PRICE_AMOUNT',
      'DROP_IN_CURRENCY',
    ])('rejects a missing %s', (variable) => {
      const env: NodeJS.ProcessEnv = { ...validEnv };
      delete env[variable];
      expect(messageOf(env)).toBe(`Invalid configuration: ${variable}: required when PAYMENTS_ENABLED=true`);
    });

    it('treats a blank value as missing', () => {
      expect(messageOf({ ...validEnv, STRIPE_SECRET_KEY: '  ' })).toBe(
        'Invalid configuration: STRIPE_SECRET_KEY: required when PAYMENTS_ENABLED=true',
      );
    });

    it('reports every problem in one error', () => {
      const message = messageOf({ PAYMENTS_ENABLED: 'true' });
      for (const variable of [
        'STRIPE_SECRET_KEY',
        'STRIPE_PUBLISHABLE_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'DROP_IN_PRICE_AMOUNT',
        'DROP_IN_CURRENCY',
      ]) {
        expect(message).toContain(`${variable}: required when PAYMENTS_ENABLED=true`);
      }
    });

    it.each([
      ['STRIPE_SECRET_KEY', 'abc', 'invalid format'],
      ['STRIPE_PUBLISHABLE_KEY', 'pk_fake', 'invalid format'],
      ['STRIPE_WEBHOOK_SECRET', 'secret_fake', 'invalid format'],
      ['DROP_IN_CURRENCY', 'euro', 'invalid format'],
      ['DROP_IN_PRICE_AMOUNT', '0', 'must be an integer between 1 and 99999999'],
      ['DROP_IN_PRICE_AMOUNT', '12.5', 'must be an integer between 1 and 99999999'],
      ['DROP_IN_PRICE_AMOUNT', '100000000', 'must be an integer between 1 and 99999999'],
      ['STRIPE_TIMEOUT_MS', '999', 'must be an integer between 1000 and 30000'],
      ['STRIPE_TIMEOUT_MS', '30001', 'must be an integer between 1000 and 30000'],
      ['STRIPE_TIMEOUT_MS', 'fast', 'must be an integer between 1000 and 30000'],
      ['PAYMENT_HOLD_MINUTES', '0', 'must be an integer between 1 and 1440'],
      ['PAYMENT_HOLD_MINUTES', '1441', 'must be an integer between 1 and 1440'],
      ['PAYMENT_HOLD_MINUTES', 'soon', 'must be an integer between 1 and 1440'],
      ['STRIPE_LIVE_MODE_ALLOWED', 'yes', 'must be true or false'],
    ])('rejects malformed %s=%s', (variable, value, reason) => {
      expect(messageOf({ ...validEnv, [variable]: value })).toBe(
        `Invalid configuration: ${variable}: ${reason}`,
      );
    });

    it('rejects an unusable PAYMENTS_ENABLED value', () => {
      expect(messageOf({ PAYMENTS_ENABLED: 'yes' })).toBe(
        'Invalid configuration: PAYMENTS_ENABLED: must be true or false',
      );
    });

    it('never puts the rejected value in the error message', () => {
      const secret = 'leakySecretValue123';
      const message = messageOf({
        ...validEnv,
        STRIPE_SECRET_KEY: secret,
        STRIPE_PUBLISHABLE_KEY: `${secret}pk`,
        STRIPE_WEBHOOK_SECRET: `${secret}wh`,
        DROP_IN_CURRENCY: `${secret}c`,
      });
      expect(message).not.toContain(secret);
    });

    it('does not echo valid keys when another variable is wrong', () => {
      expect(messageOf({ ...validEnv, DROP_IN_PRICE_AMOUNT: '0' })).not.toMatch(/fake/);
    });

    it('accepts a complete valid environment and normalises the currency', () => {
      const { payments } = loadConfig({ ...validEnv, STRIPE_TIMEOUT_MS: '5000', PAYMENT_HOLD_MINUTES: '45' });
      expect(payments).toEqual({
        enabled: true,
        mode: 'test',
        stripeSecretKey: 'sk_test_fake',
        stripePublishableKey: 'pk_test_fake',
        stripeWebhookSecret: 'whsec_fake',
        stripeTimeoutMs: 5000,
        dropInPriceAmount: 1500,
        dropInCurrency: 'eur',
        holdMinutes: 45,
      });
    });

    it('defaults STRIPE_TIMEOUT_MS to 10000 and accepts restricted keys', () => {
      const { payments } = loadConfig({ ...validEnv, STRIPE_SECRET_KEY: 'rk_test_fake' });
      expect(payments.enabled && payments.stripeTimeoutMs).toBe(10000);
      expect(payments.mode).toBe('test');
    });

    it('defaults PAYMENT_HOLD_MINUTES to 30 (US-132)', () => {
      expect(loadConfig(validEnv).payments.holdMinutes).toBe(30);
    });
  });

  describe('AC 3: live-mode guard', () => {
    const liveEnv = {
      ...validEnv,
      STRIPE_SECRET_KEY: 'sk_live_x',
      STRIPE_PUBLISHABLE_KEY: 'pk_live_x',
    };

    it('rejects a live key unless STRIPE_LIVE_MODE_ALLOWED=true', () => {
      expect(messageOf(liveEnv)).toBe(
        'Invalid configuration: STRIPE_SECRET_KEY: live keys are not allowed in this environment',
      );
      expect(messageOf({ ...liveEnv, STRIPE_LIVE_MODE_ALLOWED: 'false' })).toContain(
        'STRIPE_SECRET_KEY: live keys are not allowed in this environment',
      );
    });

    it('rejects a restricted live key without the flag', () => {
      expect(messageOf({ ...liveEnv, STRIPE_SECRET_KEY: 'rk_live_x' })).toContain(
        'live keys are not allowed in this environment',
      );
    });

    it('accepts live keys with the flag and reports mode live', () => {
      const { payments } = loadConfig({ ...liveEnv, STRIPE_LIVE_MODE_ALLOWED: 'true' });
      expect(payments.mode).toBe('live');
    });

    it('rejects a secret and publishable key from different modes', () => {
      expect(messageOf({ ...validEnv, STRIPE_PUBLISHABLE_KEY: 'pk_live_x' })).toBe(
        'Invalid configuration: STRIPE_PUBLISHABLE_KEY: mode does not match STRIPE_SECRET_KEY',
      );
      expect(
        messageOf({ ...validEnv, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_LIVE_MODE_ALLOWED: 'true' }),
      ).toBe('Invalid configuration: STRIPE_PUBLISHABLE_KEY: mode does not match STRIPE_SECRET_KEY');
    });
  });

  describe('AC 4: disabled by default', () => {
    const paymentsOff = {
      enabled: false,
      mode: null,
      stripeSecretKey: null,
      stripePublishableKey: null,
      stripeWebhookSecret: null,
      stripeTimeoutMs: null,
      dropInPriceAmount: null,
      dropInCurrency: null,
      holdMinutes: null,
    };

    it('starts with an empty environment and payments off', () => {
      expect(loadConfig({}).payments).toEqual(paymentsOff);
    });

    it('ignores Stripe variables, even malformed ones, when PAYMENTS_ENABLED=false', () => {
      const { payments } = loadConfig({
        PAYMENTS_ENABLED: 'false',
        STRIPE_SECRET_KEY: 'abc',
        DROP_IN_PRICE_AMOUNT: '0',
        PAYMENT_HOLD_MINUTES: '0',
      });
      expect(payments.enabled).toBe(false);
      expect(payments.stripeSecretKey).toBeNull();
    });

    it('ignores a malformed STRIPE_LIVE_MODE_ALLOWED when PAYMENTS_ENABLED=false', () => {
      expect(loadConfig({ PAYMENTS_ENABLED: 'false', STRIPE_LIVE_MODE_ALLOWED: 'yes' }).payments).toEqual(
        paymentsOff,
      );
      expect(loadConfig({ STRIPE_LIVE_MODE_ALLOWED: 'yes' }).payments).toEqual(paymentsOff);
    });

    it('logs payments.enabled=false when off', () => {
      expect(describePayments(loadConfig({}).payments)).toBe('payments.enabled=false');
    });

    it('logs payments.enabled=true with the mode and never a key when on', () => {
      const line = describePayments(loadConfig(validEnv).payments);
      expect(line).toBe('payments.enabled=true mode=test');
      expect(line).not.toContain('fake');
    });

    it('logs mode=live for live keys', () => {
      const line = describePayments(
        loadConfig({
          ...validEnv,
          STRIPE_SECRET_KEY: 'sk_live_x',
          STRIPE_PUBLISHABLE_KEY: 'pk_live_x',
          STRIPE_LIVE_MODE_ALLOWED: 'true',
        }).payments,
      );
      expect(line).toBe('payments.enabled=true mode=live');
    });
  });
});
