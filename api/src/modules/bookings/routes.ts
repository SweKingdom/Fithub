import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser } from '../auth/hooks.js';
import { bookingDtoSchema } from './dto.js';
import { onlyMembersCanBook } from './errors.js';
import { bookClass, type BookingDeps } from './service.js';

const bookParamsSchema = z.object({ classId: z.string().uuid('Choose a valid class.') });

/**
 * Booking routes, registered inside the `/api` scope: the global `authHook` has already required a
 * session. The role is checked before the params are validated, so staff always get 403.
 */
export function bookingRoutes(deps: BookingDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/classes/:classId/bookings',
      {
        preValidation: async (request) => {
          if (currentUser(request).role !== 'member') throw onlyMembersCanBook();
        },
        schema: { params: bookParamsSchema, response: { 201: bookingDtoSchema, 202: bookingDtoSchema } },
      },
      async (request, reply) => {
        const { booking, httpStatus } = await bookClass(deps, currentUser(request), request.params.classId);
        void reply.code(httpStatus);
        if (httpStatus === 201) void reply.header('Location', `/api/bookings/${booking.id}`);
        return booking;
      },
    );
  };
}
