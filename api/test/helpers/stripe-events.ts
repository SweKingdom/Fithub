import Stripe from 'stripe';

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
