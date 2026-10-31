import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUser } from '../auth/hooks.js';
import { getSchedule, type ScheduleDeps } from './service.js';
import { scheduleQuerySchema, scheduleResponseSchema } from './schedule.dto.js';

/**
 * Class routes, registered inside the `/api` scope. No per-route auth hook: the global `authHook`
 * protects every route there (ADR-015), before the query is validated.
 */
export function classRoutes(deps: ScheduleDeps): FastifyPluginAsyncZod {
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
  };
}
