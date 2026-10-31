import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../db/schema.js';

const DB_TIMEOUT_MS = 2000;

const healthyResponse = z.object({ status: z.literal('ok'), db: z.literal('ok') });
const unhealthyResponse = z.object({ status: z.literal('error'), db: z.literal('unreachable') });

async function pingDatabase(db: Kysely<Database>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Database ping timed out')), DB_TIMEOUT_MS);
  });
  try {
    await Promise.race([sql`select 1`.execute(db), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function healthRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    { schema: { response: { 200: healthyResponse, 503: unhealthyResponse } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await pingDatabase(db);
        return { status: 'ok' as const, db: 'ok' as const };
      } catch (error) {
        request.log.error({ err: error }, 'Health check failed: database unreachable');
        reply.code(503);
        return { status: 'error' as const, db: 'unreachable' as const };
      }
    },
  );
}
