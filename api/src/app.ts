import fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import type { Config } from './config.js';
import type { Database } from './db/schema.js';
import { healthRoutes } from './routes/health.js';

export interface AppDeps {
  config: Config;
  db: Kysely<Database>;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, db } = deps;
  const app = fastify({
    logger: { level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  healthRoutes(app, db);

  return app;
}
