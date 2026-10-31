import type { Kysely } from 'kysely';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Database } from '../../db/schema.js';
import { forbidden } from '../../shared/errors.js';
import { currentUser, requireRole } from '../auth/hooks.js';
import { CLASS_MESSAGES } from '../classes/errors.js';

export interface InstructorDto {
  id: string;
  fullName: string;
}

/** Instructors of one club, sorted by name then id. E-mail addresses are never selected. */
export async function listInstructors(db: Kysely<Database>, clubId: string): Promise<InstructorDto[]> {
  const rows = await db
    .selectFrom('app_user')
    .select(['id', 'full_name'])
    .where('role', '=', 'instructor')
    .where('club_id', '=', clubId)
    .orderBy('full_name')
    .orderBy('id')
    .execute();
  return rows.map((row) => ({ id: row.id, fullName: row.full_name }));
}

/** `true` when `userId` is an instructor of `clubId`. */
export async function findInstructorInClub(
  db: Kysely<Database>,
  userId: string,
  clubId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom('app_user')
    .select('id')
    .where('id', '=', userId)
    .where('role', '=', 'instructor')
    .where('club_id', '=', clubId)
    .executeTakeFirst();
  return row !== undefined;
}

const paramsSchema = z.object({
  clubId: z.string({ required_error: 'Choose a valid club.' }).uuid('Choose a valid club.'),
});

/** `GET /clubs/:clubId/instructors` (register inside the `/api` scope). */
export function instructorRoutes(deps: { db: Kysely<Database> }): FastifyPluginAsync {
  return async (app) => {
    app.withTypeProvider<ZodTypeProvider>().get(
      '/clubs/:clubId/instructors',
      {
        preValidation: requireRole(['instructor', 'club_manager'], CLASS_MESSAGES.roleForbidden),
        schema: { params: paramsSchema },
      },
      async (request) => {
        const user = currentUser(request);
        if (request.params.clubId !== user.clubId) throw forbidden(CLASS_MESSAGES.ownClubOnly);
        return listInstructors(deps.db, request.params.clubId);
      },
    );
  };
}
