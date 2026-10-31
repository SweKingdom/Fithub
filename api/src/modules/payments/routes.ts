import '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser, requireRole } from '../auth/hooks.js';
import { getPayment, resumePayment, type PaymentDeps } from './service.js';

const paymentParams = z.object({ bookingId: z.string().uuid() });
const RESUME_LIMIT = { max: 10, timeWindow: 60 * 1000 };

/**
 * `GET` and `POST /bookings/:bookingId/payment`, registered inside the `/api` scope (the global `authHook` runs
 * first). Members only, and only for their own bookings; amount and currency never come from the client.
 */
export function paymentRoutes(deps: PaymentDeps): FastifyPluginAsyncZod {
  return async (app) => {
    // The client secret travels in these answers: never served from a shared cache.
    app.addHook('onRequest', async (_request, reply) => {
      void reply.header('Cache-Control', 'no-store');
    });
    const membersOnly = requireRole(['member'], 'Only members can pay for bookings.');

    app.get(
      '/bookings/:bookingId/payment',
      { preValidation: membersOnly, schema: { params: paymentParams } },
      async (request) => getPayment(deps, currentUser(request), request.params.bookingId),
    );

    app.post(
      '/bookings/:bookingId/payment',
      {
        preValidation: membersOnly,
        config: {
          // Per member, counted after the sign-in check, so a client cannot hammer Stripe through this route.
          rateLimit: {
            ...RESUME_LIMIT,
            hook: 'preHandler',
            keyGenerator: (request: FastifyRequest) => request.user?.id ?? request.ip,
          },
        },
        schema: { params: paymentParams },
      },
      async (request) => resumePayment(deps, currentUser(request), request.params.bookingId),
    );
  };
}
