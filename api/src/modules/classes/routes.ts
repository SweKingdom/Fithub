import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Clock } from '../../shared/clock.js';
import { currentUser, requireRole } from '../auth/hooks.js';
import { CLASS_MESSAGES } from './errors.js';
import { scheduleQuerySchema, scheduleResponseSchema } from './schedule.dto.js';
import { createClass, getSchedule, type ScheduleDeps } from './service.js';

/**
 * Body of `POST /api/classes`. Built per app so "in the future" uses the injected clock.
 * One message per field: the first failing rule wins. Unknown keys are stripped.
 */
export function createClassBodySchema(clock: Clock) {
  const m = CLASS_MESSAGES;
  return z.object({
    clubId: z.string({ required_error: m.clubRequired, invalid_type_error: m.clubRequired }).uuid(m.clubRequired),
    name: z
      .string({ required_error: m.nameRequired, invalid_type_error: m.nameRequired })
      .trim()
      .min(1, m.nameRequired)
      .max(100, m.nameTooLong),
    startAt: z
      .string({ required_error: m.startInvalid, invalid_type_error: m.startInvalid })
      .datetime({ offset: true, message: m.startInvalid })
      .refine((value) => new Date(value) > clock.now(), { message: m.startInPast }),
    durationMinutes: z
      .number({ required_error: m.durationInvalid, invalid_type_error: m.durationInvalid })
      .int(m.durationInvalid)
      .min(1, m.durationInvalid),
    capacity: z
      .number({ required_error: m.capacityNotInteger, invalid_type_error: m.capacityNotInteger })
      .int(m.capacityNotInteger)
      .min(1, m.capacityTooLow),
    instructorId: z
      .string({ invalid_type_error: m.instructorInvalid })
      .uuid(m.instructorInvalid)
      .nullable()
      .optional(),
  });
}

/**
 * Class routes, registered inside the `/api` scope. No per-route auth hook: the global `authHook`
 * protects every route there (ADR-015), before the query or body is validated.
 */
export function classRoutes(deps: ScheduleDeps): FastifyPluginAsyncZod {
  const createBody = createClassBodySchema(deps.clock);
  return async (app) => {
    app.get(
      '/classes',
      { schema: { querystring: scheduleQuerySchema, response: { 200: scheduleResponseSchema } } },
      async (request, reply) => {
        const schedule = await getSchedule(deps, currentUser(request), request.query);
        // Member-specific statuses must never be served from a shared cache.
        void reply.header('Cache-Control', 'no-store');
        return schedule;
      },
    );

    app.post(
      '/classes',
      {
        // Before body validation: a member with an invalid body still gets 403, not 400.
        preValidation: requireRole(['instructor', 'club_manager'], CLASS_MESSAGES.roleForbidden),
        schema: { body: createBody },
      },
      async (request, reply) => {
        const dto = await createClass(deps, currentUser(request), request.body);
        return reply.code(201).header('Location', `/api/classes/${dto.id}`).send(dto);
      },
    );
  };
}
