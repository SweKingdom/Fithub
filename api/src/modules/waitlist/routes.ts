import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser, requireRole } from '../auth/hooks.js';
import { WAITLIST_MESSAGES } from './errors.js';
import { joinWaitlist, leaveWaitlist, type WaitlistDeps } from './service.js';

const classParamsSchema = z.object({ classId: z.string().uuid() });
const entryParamsSchema = z.object({ entryId: z.string().uuid() });

/**
 * `POST /api/classes/:classId/waitlist` and `DELETE /api/waitlist/:entryId`.
 * Register inside the `/api` scope: the global `authHook` (401) runs first, then this role guard
 * as `preValidation` so a non-member gets 403 before any 400.
 */
export function waitlistRoutes(deps: WaitlistDeps): FastifyPluginAsync {
  // The only place that names the guard's signature (role list + message).
  const memberOnly = requireRole(['member'], WAITLIST_MESSAGES.onlyMembers);

  return async (app) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.post(
      '/classes/:classId/waitlist',
      { preValidation: memberOnly, schema: { params: classParamsSchema } },
      async (request, reply) => {
        const entry = await joinWaitlist(deps, currentUser(request), request.params.classId);
        return reply.code(201).header('Cache-Control', 'no-store').send(entry);
      },
    );

    typed.delete(
      '/waitlist/:entryId',
      { preValidation: memberOnly, schema: { params: entryParamsSchema } },
      async (request, reply) => {
        await leaveWaitlist(deps, currentUser(request), request.params.entryId);
        return reply.code(204).send();
      },
    );
  };
}
