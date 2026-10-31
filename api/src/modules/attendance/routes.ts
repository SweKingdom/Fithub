import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { currentUser, requireRole } from '../auth/hooks.js';
import { STAFF_ONLY_MESSAGE } from '../bookings/access.js';
import { attendanceRosterSchema, classParamsSchema, saveAttendanceBodySchema } from './dto.js';
import { getAttendance, recordAttendance, type AttendanceDeps } from './service.js';

/**
 * Attendance routes, registered inside the `/api` scope (sign-in is required by the global `authHook`).
 * The role guard runs before validation; club scope is checked by the service after the class is loaded.
 */
export function attendanceRoutes(deps: AttendanceDeps): FastifyPluginAsyncZod {
  return async (app) => {
    const staffOnly = requireRole(['instructor', 'club_manager'], STAFF_ONLY_MESSAGE);

    app.get(
      '/classes/:classId/attendance',
      {
        preValidation: staffOnly,
        schema: { params: classParamsSchema, response: { 200: attendanceRosterSchema } },
      },
      async (request, reply) => {
        const roster = await getAttendance(deps, currentUser(request), request.params.classId);
        void reply.header('Cache-Control', 'no-store');
        return roster;
      },
    );

    app.put(
      '/classes/:classId/attendance',
      {
        preValidation: staffOnly,
        schema: {
          params: classParamsSchema,
          body: saveAttendanceBodySchema,
          response: { 200: attendanceRosterSchema },
        },
      },
      async (request, reply) => {
        const roster = await recordAttendance(
          deps,
          currentUser(request),
          request.params.classId,
          request.body.entries,
        );
        void reply.header('Cache-Control', 'no-store');
        return roster;
      },
    );
  };
}
