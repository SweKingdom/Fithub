import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { GatewayError, InvalidSignatureError } from '../../src/modules/payments/gateway.js';
import { createStripeGateway, mapStripeError } from '../../src/modules/payments/stripe-gateway.js';
import { paymentIntentEvent, signedWebhook } from '../helpers/stripe-events.js';

const WEBHOOK_SECRET = 'whsec_fake';

const { payments } = loadConfig({
  PAYMENTS_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_fake',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  DROP_IN_PRICE_AMOUNT: '1500',
  DROP_IN_CURRENCY: 'EUR',
});
if (!payments.enabled) throw new Error('test config must enable payments');

function stripeError(raw: Record<string, unknown>): Stripe.errors.StripeError {
  return Stripe.errors.StripeError.generate(raw as Parameters<typeof Stripe.errors.StripeError.generate>[0]);
}

/** A Stripe client whose PaymentIntents API is scripted. Never touches the network. */
function stubClient(api: { create?: unknown; retrieve?: unknown }): Stripe {
  const real = new Stripe('sk_test_fake');
  return {
    paymentIntents: { create: api.create, retrieve: api.retrieve },
    webhooks: real.webhooks,
  } as unknown as Stripe;
}

const input = {
  amount: 1500,
  currency: 'eur',
  idempotencyKey: 'booking-b1',
  metadata: { bookingId: 'b1', memberId: 'm1', paymentId: 'p1' },
};

describe('mapStripeError', () => {
  it.each([
    ['connection error / timeout', { type: 'api_connection_error', message: 'timed out' }],
    ['5xx', { type: 'api_error', statusCode: 503, message: 'down' }],
    ['429', { type: 'rate_limit_error', statusCode: 429, message: 'slow down' }],
  ])('maps %s to unavailable', (_name, raw) => {
    const mapped = mapStripeError(stripeError(raw));
    expect(mapped).toBeInstanceOf(GatewayError);
    expect(mapped.kind).toBe('unavailable');
  });

  it('maps a card error to declined and keeps the Stripe code', () => {
    const mapped = mapStripeError(
      stripeError({ type: 'card_error', code: 'card_declined', statusCode: 402, message: 'Your card was declined.' }),
    );
    expect(mapped.kind).toBe('declined');
    expect(mapped.code).toBe('card_declined');
    expect(mapped.httpStatus).toBe(402);
  });

  it.each([
    ['invalid request', { type: 'invalid_request_error', statusCode: 400, message: 'bad amount' }],
    ['authentication', { type: 'authentication_error', statusCode: 401, message: 'bad key' }],
    ['permission', { type: 'permission_error', statusCode: 403, message: 'no access' }],
    ['idempotency', { type: 'idempotency_error', statusCode: 400, message: 'key reused' }],
  ])('maps %s to rejected', (_name, raw) => {
    expect(mapStripeError(stripeError(raw)).kind).toBe('rejected');
  });

  it('maps a non-Stripe error to rejected', () => {
    const mapped = mapStripeError(new TypeError('boom'));
    expect(mapped.kind).toBe('rejected');
    expect(mapped.code).toBe('unexpected_error');
  });

  it('keeps only kind and code in the message, never the Stripe message', () => {
    const mapped = mapStripeError(
      stripeError({ type: 'card_error', code: 'card_declined', message: 'card 4242424242424242 declined' }),
    );
    expect(mapped.message).toBe('declined:card_declined');
  });

  it('passes a GatewayError through unchanged', () => {
    const original = new GatewayError('unavailable', 'x');
    expect(mapStripeError(original)).toBe(original);
  });
});

describe('createStripeGateway', () => {
  describe('AC 1: createIntent', () => {
    it('creates a card-only intent with metadata and the idempotency key', async () => {
      const create = vi.fn().mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret_fake', status: 'requires_payment_method' });
      const gateway = createStripeGateway(payments, stubClient({ create }));

      const info = await gateway.createIntent(input);

      expect(info).toEqual({ id: 'pi_1', clientSecret: 'pi_1_secret_fake', status: 'requires_payment_method' });
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(
        {
          amount: 1500,
          currency: 'eur',
          payment_method_types: ['card'],
          metadata: { bookingId: 'b1', memberId: 'm1', paymentId: 'p1' },
        },
        { idempotencyKey: 'booking-b1' },
      );
    });

    it('throws the mapped GatewayError when Stripe fails', async () => {
      const create = vi.fn().mockRejectedValue(stripeError({ type: 'api_connection_error', message: 'timed out' }));
      const gateway = createStripeGateway(payments, stubClient({ create }));
      await expect(gateway.createIntent(input)).rejects.toMatchObject({ kind: 'unavailable' });
    });

    it('rejects an intent without a client secret', async () => {
      const create = vi.fn().mockResolvedValue({ id: 'pi_1', client_secret: null, status: 'requires_payment_method' });
      const gateway = createStripeGateway(payments, stubClient({ create }));
      await expect(gateway.createIntent(input)).rejects.toMatchObject({
        kind: 'rejected',
        code: 'missing_client_secret',
      });
    });
  });

  describe('AC 8: retrieveIntent', () => {
    it('returns the existing intent and its client secret', async () => {
      const retrieve = vi.fn().mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret_fake', status: 'requires_payment_method' });
      const gateway = createStripeGateway(payments, stubClient({ retrieve }));
      await expect(gateway.retrieveIntent('pi_1')).resolves.toMatchObject({ id: 'pi_1', clientSecret: 'pi_1_secret_fake' });
      expect(retrieve).toHaveBeenCalledWith('pi_1');
    });

    it('maps an unknown intent to rejected', async () => {
      const retrieve = vi.fn().mockRejectedValue(stripeError({ type: 'invalid_request_error', statusCode: 404, message: 'no such intent' }));
      const gateway = createStripeGateway(payments, stubClient({ retrieve }));
      await expect(gateway.retrieveIntent('pi_missing')).rejects.toMatchObject({ kind: 'rejected' });
    });
  });

  describe('AC 4: webhook signature', () => {
    const gateway = createStripeGateway(payments, stubClient({}));
    const event = paymentIntentEvent('payment_intent.succeeded', {
      eventId: 'evt_1',
      intentId: 'pi_1',
      amountReceived: 1500,
      metadata: { bookingId: 'b1', paymentId: 'p1' },
    });

    it('accepts a correctly signed event and reduces it to what FitHub reads', () => {
      const { payload, headers } = signedWebhook(WEBHOOK_SECRET, event);
      expect(gateway.constructEvent(Buffer.from(payload), headers['stripe-signature'])).toEqual({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        objectId: 'pi_1',
        amountReceived: 1500,
        metadata: { bookingId: 'b1', paymentId: 'p1' },
      });
    });

    it('rejects a missing signature header', () => {
      const { payload } = signedWebhook(WEBHOOK_SECRET, event);
      expect(() => gateway.constructEvent(Buffer.from(payload), undefined)).toThrow(InvalidSignatureError);
    });

    it('rejects a body that was altered after signing', () => {
      const { payload, headers } = signedWebhook(WEBHOOK_SECRET, event);
      const altered = payload.replace('1500', '1');
      expect(() => gateway.constructEvent(Buffer.from(altered), headers['stripe-signature'])).toThrow(
        InvalidSignatureError,
      );
    });

    it('rejects a signature made with another secret', () => {
      const { payload, headers } = signedWebhook('whsec_other', event);
      expect(() => gateway.constructEvent(Buffer.from(payload), headers['stripe-signature'])).toThrow(
        InvalidSignatureError,
      );
    });

    it('rejects a malformed header', () => {
      const { payload } = signedWebhook(WEBHOOK_SECRET, event);
      expect(() => gateway.constructEvent(Buffer.from(payload), 'not-a-signature')).toThrow(InvalidSignatureError);
    });

    it('does not put the body or the secret in the error', () => {
      const { payload } = signedWebhook(WEBHOOK_SECRET, event);
      try {
        gateway.constructEvent(Buffer.from(payload), 'bad');
        throw new Error('expected constructEvent to throw');
      } catch (error) {
        expect((error as Error).message).not.toContain(WEBHOOK_SECRET);
        expect((error as Error).message).not.toContain('pi_1');
      }
    });
  });
});
