import Stripe from 'stripe';
import type { PaymentsConfig } from '../../config.js';
import {
  GatewayError,
  InvalidSignatureError,
  type CreateIntentInput,
  type PaymentGateway,
  type PaymentIntentInfo,
  type WebhookEvent,
} from './gateway.js';

/**
 * Stripe API version this code was written against. The webhook endpoint in the Stripe dashboard
 * must use the same version (README, "Stripe webhook per environment"). Change both together.
 */
export const STRIPE_API_VERSION = '2025-09-30.clover';

type EnabledPaymentsConfig = Extract<PaymentsConfig, { enabled: true }>;

const MAX_CODE_LENGTH = 100;

/**
 * Maps any error thrown by the Stripe SDK to a `GatewayError`:
 * connection error / timeout / 5xx / 429 → `unavailable`; card error → `declined`;
 * everything else (invalid request, auth, permission, idempotency, unexpected) → `rejected`.
 * Only the error code is kept: Stripe messages can quote request data.
 */
export function mapStripeError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;
  if (!(error instanceof Stripe.errors.StripeError)) return new GatewayError('rejected', 'unexpected_error');

  const code = (error.code ?? error.type).slice(0, MAX_CODE_LENGTH);
  const status = error.statusCode;

  if (error instanceof Stripe.errors.StripeCardError) return new GatewayError('declined', code, status);
  if (
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeRateLimitError ||
    error instanceof Stripe.errors.StripeAPIError ||
    status === 429 ||
    (status !== undefined && status >= 500)
  ) {
    return new GatewayError('unavailable', code, status);
  }
  return new GatewayError('rejected', code, status);
}

function toIntentInfo(intent: Stripe.PaymentIntent): PaymentIntentInfo {
  if (!intent.client_secret) throw new GatewayError('rejected', 'missing_client_secret');
  return { id: intent.id, clientSecret: intent.client_secret, status: intent.status };
}

async function guarded<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw mapStripeError(error);
  }
}

function toWebhookEvent(event: Stripe.Event): WebhookEvent {
  const object = event.data.object as unknown as Record<string, unknown>;
  const metadata: Record<string, string> = {};
  if (typeof object.metadata === 'object' && object.metadata !== null) {
    for (const [key, value] of Object.entries(object.metadata)) {
      if (typeof value === 'string') metadata[key] = value;
    }
  }
  return {
    id: event.id,
    type: event.type,
    objectId: typeof object.id === 'string' ? object.id : null,
    amountReceived: typeof object.amount_received === 'number' ? object.amount_received : null,
    metadata,
  };
}

/**
 * Stripe implementation of the payment gateway. One attempt per call: `maxNetworkRetries` is 0
 * because retries are owned by the payment-retry job (US-133) and guarded by the idempotency key.
 * `client` is injectable for tests; CI never calls Stripe.
 */
export function createStripeGateway(
  config: EnabledPaymentsConfig,
  client: Stripe = new Stripe(config.stripeSecretKey, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    timeout: config.stripeTimeoutMs,
    maxNetworkRetries: 0,
    appInfo: { name: 'FitHub' },
  }),
): PaymentGateway {
  return {
    async createIntent(input: CreateIntentInput): Promise<PaymentIntentInfo> {
      const intent = await guarded(() =>
        client.paymentIntents.create(
          {
            amount: input.amount,
            currency: input.currency,
            payment_method_types: ['card'],
            metadata: { ...input.metadata },
          },
          { idempotencyKey: input.idempotencyKey },
        ),
      );
      return toIntentInfo(intent);
    },

    async retrieveIntent(intentId: string): Promise<PaymentIntentInfo> {
      const intent = await guarded(() => client.paymentIntents.retrieve(intentId));
      return toIntentInfo(intent);
    },

    constructEvent(rawBody: Buffer, signatureHeader: string | undefined): WebhookEvent {
      if (!signatureHeader) throw new InvalidSignatureError();
      let event: Stripe.Event;
      try {
        event = client.webhooks.constructEvent(rawBody, signatureHeader, config.stripeWebhookSecret);
      } catch {
        throw new InvalidSignatureError();
      }
      return toWebhookEvent(event);
    },
  };
}
