import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser, requireRole } from '../auth/hooks.js';
import {
  bookingDtoSchema,
  cancelBooking,
  getBooking,
  getClassRoster,
  listMyBookings,
  myBookingsQuerySchema,
  myBookingsResponseSchema,
  rosterResponseSchema,
  type BookingDeps,
} from './service.js';

const bookingParams = z.object({ id: z.string().uuid() });
const classParams = z.object({ classId: z.string().uuid() });

/**
 * Booking routes, registered inside the `/api` scope (the global `authHook` runs first, ADR-015). Who may see or
 * change which booking is decided in `access.ts`.
 */
export function bookingRoutes(deps: Omit<BookingDeps, 'notifier' | 'logger'>): FastifyPluginAsyncZod {
  return async (app) => {
    const full: BookingDeps = { ...deps, notifier: app.notifier, logger: app.log };

    // Booking data is personal: never served from a shared cache.
    app.addHook('onRequest', async (_request, reply) => {
      void reply.header('Cache-Control', 'no-store');
    });

    app.get(
      '/me/bookings',
      {
        preValidation: requireRole(['member'], 'Only members can view their bookings.'),
        schema: { querystring: myBookingsQuerySchema, response: { 200: myBookingsResponseSchema } },
      },
      async (request) => listMyBookings(full, currentUser(request), request.query),
    );

    app.get(
      '/bookings/:id',
      { schema: { params: bookingParams, response: { 200: bookingDtoSchema } } },
      async (request) => getBooking(full, currentUser(request), request.params.id),
    );

    app.post(
      '/bookings/:id/cancel',
      {
        preValidation: requireRole(['member'], 'Only members can cancel their own bookings.'),
        schema: { params: bookingParams, response: { 200: bookingDtoSchema } },
      },
      async (request) => cancelBooking(full, currentUser(request), request.params.id),
    );

    app.get(
      '/classes/:classId/bookings',
      {
        preValidation: requireRole(
          ['instructor', 'club_manager'],
          'Only instructors and club managers can manage classes.',
        ),
        schema: { params: classParams, response: { 200: rosterResponseSchema } },
      },
      async (request) => getClassRoster(full, currentUser(request), request.params.classId),
    );
  };
}
