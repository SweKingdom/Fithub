import Stripe from 'stripe';
import { loadConfig, type AppConfig } from '../../src/config.js';

export const WEBHOOK_SECRET = 'whsec_testsecret123';
export const PUBLISHABLE_KEY = 'pk_test_abc123';
export const DROP_IN_PRICE = 1500;

/** The app configuration with payments on (test keys, price 1500, EUR). No Stripe call is ever made with it. */
export function paymentsConfig(env: Record<string, string> = {}): AppConfig {
  return loadConfig({
    PAYMENTS_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_test_abc123',
    STRIPE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    DROP_IN_PRICE_AMOUNT: String(DROP_IN_PRICE),
    DROP_IN_CURRENCY: 'EUR',
    ...env,
  });
}

export interface SignedWebhook {
  /** The exact bytes to send as the request body. */
  payload: string;
  headers: { 'content-type': 'application/json'; 'stripe-signature': string };
}

/** Signs a Stripe event the way Stripe does, using the SDK's test helper. No network. */
export function signedWebhook(secret: string, event: Record<string, unknown>): SignedWebhook {
  const payload = JSON.stringify(event);
  const signature = new Stripe('sk_test_fake').webhooks.generateTestHeaderString({ payload, secret });
  return { payload, headers: { 'content-type': 'application/json', 'stripe-signature': signature } };
}

/** A minimal `payment_intent.*` event for the given PaymentIntent. */
export function paymentIntentEvent(
  type: 'payment_intent.succeeded' | 'payment_intent.payment_failed',
  options: { eventId: string; intentId: string; amountReceived?: number; metadata?: Record<string, string> },
): Record<string, unknown> {
  return {
    id: options.eventId,
    object: 'event',
    type,
    data: {
      object: {
        id: options.intentId,
        object: 'payment_intent',
        amount_received: options.amountReceived ?? 0,
        metadata: options.metadata ?? {},
      },
    },
  };
}
