import type { Kysely } from 'kysely';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ClubDatabase } from './db-types.js';
import { ClubDtoSchema, toClubDto } from './dto.js';
import { listClubs } from './repository.js';

export interface ClubRouteDeps {
  db: Kysely<ClubDatabase>;
}

/**
 * Club routes, registered inside the `/api` scope. No per-route auth hook: the global `authHook`
 * protects every route there (ADR-015, US-118). Clubs are read-only here; the seed CLI is the only writer.
 */
export function clubRoutes(deps: ClubRouteDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get('/clubs', { schema: { response: { 200: z.array(ClubDtoSchema) } } }, async () => {
      const rows = await listClubs(deps.db);
      return rows.map(toClubDto);
    });
  };
}
