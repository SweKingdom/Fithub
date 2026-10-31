import { z } from 'zod';

/**
 * Environment parsing and validation: core settings (TK-119) and the payment (Stripe) settings
 * (TK-131, ADR-022). Error messages name the variable and the reason, never the value.
 */

export type StripeMode = 'test' | 'live';

export type PaymentsConfig =
  | {
      enabled: false;
      mode: null;
      stripeSecretKey: null;
      stripePublishableKey: null;
      stripeWebhookSecret: null;
      stripeTimeoutMs: null;
      dropInPriceAmount: null;
      dropInCurrency: null;
    }
  | {
      enabled: true;
      mode: StripeMode;
      stripeSecretKey: string;
      stripePublishableKey: string;
      stripeWebhookSecret: string;
      stripeTimeoutMs: number;
      dropInPriceAmount: number;
      dropInCurrency: string;
    };

const coreSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof coreSchema> & { payments: PaymentsConfig };

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const SECRET_KEY_PATTERN = /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/;
const PUBLISHABLE_KEY_PATTERN = /^pk_(test|live)_[A-Za-z0-9]+$/;
const WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9]+$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
const INTEGER_PATTERN = /^\d+$/;

const DEFAULT_STRIPE_TIMEOUT_MS = 10000;
const REQUIRED_WHEN_ENABLED = 'required when PAYMENTS_ENABLED=true';

const PAYMENT_VARIABLES = [
  'PAYMENTS_ENABLED',
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_LIVE_MODE_ALLOWED',
  'STRIPE_TIMEOUT_MS',
  'DROP_IN_PRICE_AMOUNT',
  'DROP_IN_CURRENCY',
] as const;

const paymentEnvSchema = z
  .object({
    PAYMENTS_ENABLED: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_LIVE_MODE_ALLOWED: z.string().optional(),
    STRIPE_TIMEOUT_MS: z.string().optional(),
    DROP_IN_PRICE_AMOUNT: z.string().optional(),
    DROP_IN_CURRENCY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const fail = (variable: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [variable], message });
    };

    const paymentsEnabled = parseBoolean(env.PAYMENTS_ENABLED);
    if (paymentsEnabled === 'invalid') fail('PAYMENTS_ENABLED', 'must be true or false');

    // Rule 1: payments off (or an unusable switch) → no payment checks, Stripe variables are ignored.
    if (paymentsEnabled !== true) return;

    const liveAllowed = parseBoolean(env.STRIPE_LIVE_MODE_ALLOWED);
    if (liveAllowed === 'invalid') fail('STRIPE_LIVE_MODE_ALLOWED', 'must be true or false');

    // Rules 2 and 3: presence, then format. The value is never echoed.
    const checkFormat = (
      variable: string,
      value: string | undefined,
      pattern: RegExp,
    ): string | null => {
      if (value === undefined) {
        fail(variable, REQUIRED_WHEN_ENABLED);
        return null;
      }
      if (!pattern.test(value)) {
        fail(variable, 'invalid format');
        return null;
      }
      return value;
    };

    const checkInteger = (
      variable: string,
      value: string | undefined,
      min: number,
      max: number,
      optional: boolean,
    ): void => {
      if (value === undefined) {
        if (!optional) fail(variable, REQUIRED_WHEN_ENABLED);
        return;
      }
      const parsed = INTEGER_PATTERN.test(value) ? Number(value) : NaN;
      if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
        fail(variable, `must be an integer between ${min} and ${max}`);
      }
    };

    const secretKey = checkFormat('STRIPE_SECRET_KEY', env.STRIPE_SECRET_KEY, SECRET_KEY_PATTERN);
    const publishableKey = checkFormat(
      'STRIPE_PUBLISHABLE_KEY',
      env.STRIPE_PUBLISHABLE_KEY,
      PUBLISHABLE_KEY_PATTERN,
    );
    checkFormat('STRIPE_WEBHOOK_SECRET', env.STRIPE_WEBHOOK_SECRET, WEBHOOK_SECRET_PATTERN);
    checkFormat('DROP_IN_CURRENCY', env.DROP_IN_CURRENCY, CURRENCY_PATTERN);
    checkInteger('DROP_IN_PRICE_AMOUNT', env.DROP_IN_PRICE_AMOUNT, 1, 99999999, false);
    checkInteger('STRIPE_TIMEOUT_MS', env.STRIPE_TIMEOUT_MS, 1000, 30000, true);

    // Rule 4: both keys must come from the same Stripe mode.
    if (secretKey && publishableKey && modeOf(secretKey) !== modeOf(publishableKey)) {
      fail('STRIPE_PUBLISHABLE_KEY', 'mode does not match STRIPE_SECRET_KEY');
    }

    // Rule 5: live keys only where explicitly allowed.
    if (secretKey && modeOf(secretKey) === 'live' && liveAllowed !== true) {
      fail('STRIPE_SECRET_KEY', 'live keys are not allowed in this environment');
    }
  });

type PaymentEnv = z.infer<typeof paymentEnvSchema>;

function parseBoolean(value: string | undefined): boolean | 'invalid' {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  return 'invalid';
}

function modeOf(key: string): StripeMode {
  return key.includes('_live_') ? 'live' : 'test';
}

/** Blank values (e.g. `STRIPE_SECRET_KEY=` in a .env file) count as not set. */
function pickPaymentEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const picked: Record<string, string | undefined> = {};
  for (const name of PAYMENT_VARIABLES) {
    const value = env[name];
    picked[name] = value === undefined || value.trim() === '' ? undefined : value.trim();
  }
  return picked;
}

/** Builds the typed payments config from an already validated environment. */
function toPaymentsConfig(env: PaymentEnv): PaymentsConfig {
  if (env.PAYMENTS_ENABLED !== 'true') {
    return {
      enabled: false,
      mode: null,
      stripeSecretKey: null,
      stripePublishableKey: null,
      stripeWebhookSecret: null,
      stripeTimeoutMs: null,
      dropInPriceAmount: null,
      dropInCurrency: null,
    };
  }
  const secretKey = env.STRIPE_SECRET_KEY as string;
  return {
    enabled: true,
    mode: modeOf(secretKey),
    stripeSecretKey: secretKey,
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY as string,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET as string,
    stripeTimeoutMs:
      env.STRIPE_TIMEOUT_MS === undefined
        ? DEFAULT_STRIPE_TIMEOUT_MS
        : Number(env.STRIPE_TIMEOUT_MS),
    dropInPriceAmount: Number(env.DROP_IN_PRICE_AMOUNT),
    dropInCurrency: (env.DROP_IN_CURRENCY as string).toLowerCase(),
  };
}

function describeIssue(issue: z.ZodIssue): string {
  return `${issue.path.join('.') || 'unknown'}: ${issue.message}`;
}

/** Parses and validates the environment. Throws `ConfigError` listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const core = coreSchema.safeParse(env);
  const payments = paymentEnvSchema.safeParse(pickPaymentEnv(env));
  if (!core.success || !payments.success) {
    const problems = [
      ...(core.success ? [] : core.error.issues.map(describeIssue)),
      ...(payments.success ? [] : payments.error.issues.map(describeIssue)),
    ];
    throw new ConfigError(`Invalid configuration: ${problems.join('; ')}`);
  }
  return { ...core.data, payments: toPaymentsConfig(payments.data) };
}

/** One startup log fragment about payments. Never contains a key or secret. */
export function describePayments(payments: PaymentsConfig): string {
  return payments.enabled
    ? `payments.enabled=true mode=${payments.mode}`
    : 'payments.enabled=false';
}
