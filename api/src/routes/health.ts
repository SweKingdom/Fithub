import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema.js';

/** `GET /health` (outside `/api`, public): 200 when the database answers, 503 without any error detail. */
export function healthRoutes(db: Kysely<Database>): FastifyPluginAsyncZod {
  return async (app) => {
    app.get('/health', async (request, reply) => {
      try {
        await sql`SELECT 1`.execute(db);
        return { status: 'ok', db: 'ok' };
      } catch (error) {
        request.log.warn({ err: error }, 'health check: database unreachable');
        return reply.code(503).send({ status: 'error', db: 'unreachable' });
      }
    });
  };
}
