import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../db/schema.js';
import { listClubs } from './repository.js';

const clubSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  timezone: z.string(),
});

/** `GET /clubs`, registered inside the `/api` scope: the global `authHook` protects it (ADR-015). */
export function clubRoutes(db: Kysely<Database>): FastifyPluginAsyncZod {
  return async (app) => {
    app.get('/clubs', { schema: { response: { 200: z.array(clubSchema) } } }, async () => listClubs(db));
  };
}
