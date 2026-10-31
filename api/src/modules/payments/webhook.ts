import type { FastifyPluginAsync } from 'fastify';
import { invalidSignature } from './errors.js';
import { InvalidSignatureError, type WebhookEvent } from './gateway.js';
import { handleStripeEvent, type PaymentDeps } from './service.js';

const BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * `POST /webhooks/stripe`, registered at the root (outside `/api`: no session, no origin guard, no rate limit).
 * Authenticity comes from the signature over the raw body only, so this plugin keeps the body as a `Buffer`
 * instead of parsing it. Processing errors answer 500 and Stripe retries; a bad signature answers 400 and
 * never echoes the body or the secret.
 */
export function webhookRoutes(deps: PaymentDeps): FastifyPluginAsync {
  return async (app) => {
    app.removeAllContentTypeParsers();
    app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: BODY_LIMIT_BYTES }, (_request, body, done) => {
      done(null, body);
    });

    app.post(
      '/webhooks/stripe',
      { bodyLimit: BODY_LIMIT_BYTES, config: { public: true } },
      async (request) => {
        const header = request.headers['stripe-signature'];
        const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        let event: WebhookEvent;
        try {
          event = deps.gateway.constructEvent(raw, typeof header === 'string' ? header : undefined);
        } catch (error) {
          if (!(error instanceof InvalidSignatureError)) throw error;
          request.log.warn({ ip: request.ip }, 'stripe.invalid_signature');
          throw invalidSignature();
        }
        await handleStripeEvent(deps, event);
        return { received: true };
      },
    );
  };
}
