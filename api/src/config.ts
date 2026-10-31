import { z } from 'zod';

/**
 * Environment parsing and validation: payment (Stripe) settings (TK-131, ADR-022), sign-in/session settings
 * (US-118, ADR-014), waiting-list and background-job settings (US-128) and no-show block settings (US-130).
 * Error messages name the variable and the reason, never the value.
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

/** Sign-in, session and request-origin settings (US-118). */
export interface AuthConfig {
  /** Origin of the SPA; state-changing requests from another origin are refused. */
  appOrigin: string;
  sessionCookieSecure: boolean;
  sessionIdleTimeoutMinutes: number;
  sessionMaxAgeHours: number;
  /** scrypt `N`: a power of two, at least 16384. */
  scryptCost: number;
  loginRateLimitMax: number;
  loginRateLimitWindowMinutes: number;
  /** True behind a reverse proxy, so `request.ip` is the client address. */
  trustProxy: boolean;
}

/** Waiting-list promotion settings (US-128). */
export interface WaitlistConfig {
  /** No promotion (and no joining) from `start_at − this` onward. 0 = until the class starts. */
  promotionCutoffMinutes: number;
  /** How often the `waitlist-maintenance` job runs. */
  jobIntervalSeconds: number;
}

export type NoShowWindowKind = 'rolling_days' | 'calendar_month';

/** No-show block settings (US-130). Changes affect only future decisions; existing blocks are not recalculated. */
export interface NoShowConfig {
  /** Uncounted no-shows in the window that create a block. */
  threshold: number;
  window: NoShowWindowKind;
  /** Length of the rolling window; used when `window` is `rolling_days`. */
  windowDays: number;
  /** How long a block lasts. */
  blockDays: number;
}

/** Background jobs (ADR-007). */
export interface JobsConfig {
  enabled: boolean;
}

export interface AppConfig {
  payments: PaymentsConfig;
  auth: AuthConfig;
  waitlist: WaitlistConfig;
  noShow: NoShowConfig;
  jobs: JobsConfig;
}

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

const DEFAULT_APP_ORIGIN = 'http://localhost:5173';
const MIN_SCRYPT_COST = 16384;

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

const envSchema = z
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
    const checkFormat = (variable: string, value: string | undefined, pattern: RegExp): string | null => {
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

type PaymentEnv = z.infer<typeof envSchema>;

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

/** Builds the typed config from an already validated environment. */
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
      env.STRIPE_TIMEOUT_MS === undefined ? DEFAULT_STRIPE_TIMEOUT_MS : Number(env.STRIPE_TIMEOUT_MS),
    dropInPriceAmount: Number(env.DROP_IN_PRICE_AMOUNT),
    dropInCurrency: (env.DROP_IN_CURRENCY as string).toLowerCase(),
  };
}

function readText(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function readBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean, problems: string[]): boolean {
  const value = readText(env, name);
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  problems.push(`${name}: must be true or false`);
  return fallback;
}

/** Without `max` the value only has a lower bound. */
function readInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  problems: string[],
  max?: number,
): number {
  const value = readText(env, name);
  if (value === undefined) return fallback;
  const parsed = INTEGER_PATTERN.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    problems.push(
      max === undefined
        ? `${name}: must be an integer of at least ${min}`
        : `${name}: must be an integer between ${min} and ${max}`,
    );
    return fallback;
  }
  return parsed;
}

function readChoice<T extends string>(
  env: NodeJS.ProcessEnv,
  name: string,
  choices: readonly T[],
  fallback: T,
  problems: string[],
): T {
  const value = readText(env, name);
  if (value === undefined) return fallback;
  const match = choices.find((choice) => choice === value);
  if (match === undefined) {
    problems.push(`${name}: must be one of ${choices.join(', ')}`);
    return fallback;
  }
  return match;
}

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

/** Sign-in and session settings (US-118). Appends one entry to `problems` per invalid variable. */
function parseAuthConfig(env: NodeJS.ProcessEnv, problems: string[]): AuthConfig {
  const production = readText(env, 'NODE_ENV') === 'production';

  let appOrigin = readText(env, 'APP_ORIGIN');
  if (appOrigin === undefined) {
    if (production) problems.push('APP_ORIGIN: required when NODE_ENV=production');
    appOrigin = DEFAULT_APP_ORIGIN;
  } else if (!isOrigin(appOrigin)) {
    problems.push('APP_ORIGIN: must be an origin such as https://app.example.com (no path, no trailing slash)');
    appOrigin = DEFAULT_APP_ORIGIN;
  }

  const sessionCookieSecure = readBoolean(env, 'SESSION_COOKIE_SECURE', production, problems);
  if (production && !sessionCookieSecure) {
    problems.push('SESSION_COOKIE_SECURE: must be true when NODE_ENV=production');
  }

  let scryptCost = readInteger(env, 'AUTH_SCRYPT_COST', 131072, 1, problems);
  if (scryptCost < MIN_SCRYPT_COST || (scryptCost & (scryptCost - 1)) !== 0) {
    if (readText(env, 'AUTH_SCRYPT_COST') !== undefined) {
      problems.push(`AUTH_SCRYPT_COST: must be a power of two of at least ${MIN_SCRYPT_COST}`);
    }
    scryptCost = 131072;
  }

  return {
    appOrigin,
    sessionCookieSecure,
    sessionIdleTimeoutMinutes: readInteger(env, 'SESSION_IDLE_TIMEOUT_MINUTES', 720, 5, problems),
    sessionMaxAgeHours: readInteger(env, 'SESSION_MAX_AGE_HOURS', 168, 1, problems),
    scryptCost,
    loginRateLimitMax: readInteger(env, 'LOGIN_RATE_LIMIT_MAX', 10, 1, problems),
    loginRateLimitWindowMinutes: readInteger(env, 'LOGIN_RATE_LIMIT_WINDOW_MINUTES', 15, 1, problems),
    trustProxy: readBoolean(env, 'TRUST_PROXY', false, problems),
  };
}

/** Waiting-list settings (US-128). Appends one entry to `problems` per invalid variable. */
function parseWaitlistConfig(env: NodeJS.ProcessEnv, problems: string[]): WaitlistConfig {
  return {
    promotionCutoffMinutes: readInteger(env, 'WAITLIST_PROMOTION_CUTOFF_MINUTES', 0, 0, problems),
    jobIntervalSeconds: readInteger(env, 'WAITLIST_JOB_INTERVAL_SECONDS', 60, 10, problems),
  };
}

/** No-show block settings (US-130). Defaults are provisional until the product owner confirms them. */
function parseNoShowConfig(env: NodeJS.ProcessEnv, problems: string[]): NoShowConfig {
  return {
    threshold: readInteger(env, 'NO_SHOW_THRESHOLD', 3, 1, problems, 20),
    window: readChoice(env, 'NO_SHOW_WINDOW', ['rolling_days', 'calendar_month'], 'rolling_days', problems),
    windowDays: readInteger(env, 'NO_SHOW_WINDOW_DAYS', 30, 1, problems, 366),
    blockDays: readInteger(env, 'NO_SHOW_BLOCK_DAYS', 7, 1, problems, 90),
  };
}

/** Background jobs run by default, except under `NODE_ENV=test`, where tests call the jobs directly. */
function parseJobsConfig(env: NodeJS.ProcessEnv, problems: string[]): JobsConfig {
  const testing = readText(env, 'NODE_ENV') === 'test';
  return { enabled: readBoolean(env, 'JOBS_ENABLED', !testing, problems) };
}

/** Parses and validates the environment. Throws `ConfigError` listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(pickPaymentEnv(env));
  const problems: string[] = result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  const auth = parseAuthConfig(env, problems);
  const waitlist = parseWaitlistConfig(env, problems);
  const noShow = parseNoShowConfig(env, problems);
  const jobs = parseJobsConfig(env, problems);
  if (problems.length > 0 || !result.success) {
    throw new ConfigError(`Invalid configuration: ${problems.join('; ')}`);
  }
  return { payments: toPaymentsConfig(result.data), auth, waitlist, noShow, jobs };
}

/** One startup log fragment about payments. Never contains a key or secret. */
export function describePayments(payments: PaymentsConfig): string {
  return payments.enabled ? `payments.enabled=true mode=${payments.mode}` : 'payments.enabled=false';
}
