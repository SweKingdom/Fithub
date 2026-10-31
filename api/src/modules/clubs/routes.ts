import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../db/schema.js';
import { ClubDtoSchema, toClubDto } from './dto.js';
import { listClubs } from './repository.js';

/**
 * `GET /clubs`, registered inside the `/api` scope: the global `authHook` protects it (ADR-015).
 * Clubs are read-only here; the seed CLI is the only writer.
 */
export function clubRoutes(db: Kysely<Database>): FastifyPluginAsyncZod {
  return async (app) => {
    app.get('/clubs', { schema: { response: { 200: z.array(ClubDtoSchema) } } }, async () => {
      const rows = await listClubs(db);
      return rows.map(toClubDto);
    });
  };
}
