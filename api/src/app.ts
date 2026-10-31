import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { loadConfig, type AppConfig } from './config.js';
import { createDbFromEnv } from './db/client.js';
import type { Database } from './db/schema.js';
import { authHook, originGuard } from './modules/auth/hooks.js';
import { authRoutes } from './modules/auth/routes.js';
import { classRoutes } from './modules/classes/routes.js';
import { clubRoutes } from './modules/clubs/routes.js';
import { healthRoutes } from './routes/health.js';
import { systemClock, type Clock } from './shared/clock.js';
import { registerErrorHandler } from './shared/errors.js';

/** One registered route, recorded by the `onRoute` hook (the route-table test of ADR-015 reads it). */
export interface RouteTableEntry {
  method: string | string[];
  url: string;
  public: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    routeTable: readonly RouteTableEntry[];
  }
}

/** No password, session token or cookie ever reaches the log (US-118 AC 9). */
const LOG_REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
];

export interface BuildAppOptions {
  /** Defaults to `loadConfig()` (the process environment). */
  config?: AppConfig;
  /** Defaults to a connection from `DATABASE_URL`, closed together with the app. */
  db?: Kysely<Database>;
  clock?: Clock;
  /** Log level and destination; redaction is always applied. */
  logger?: { level?: string; stream?: { write(line: string): void } };
}

/** Builds the Fastify app with injected dependencies. Never listens: `server.ts` does that. */
export async function buildApp(options: BuildAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const clock = options.clock ?? systemClock;
  const db = options.db ?? createDbFromEnv();

  const logger = {
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
    ...options.logger,
    redact: LOG_REDACT,
  };
  const app = Fastify({
    logger: logger as FastifyServerOptions['logger'],
    trustProxy: config.auth.trustProxy,
  }).withTypeProvider<ZodTypeProvider>();

  // First, so that it sees every route registered afterwards.
  const routeTable: RouteTableEntry[] = [];
  app.addHook('onRoute', (route) => {
    routeTable.push({ method: route.method, url: route.url, public: route.config?.public === true });
  });
  app.decorate('routeTable', routeTable);

  if (options.db === undefined) app.addHook('onClose', () => db.destroy());

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  await app.register(healthRoutes(db));

  await app.register(
    async (api) => {
      api.addHook('onRequest', originGuard(config.auth.appOrigin));
      api.addHook('onRequest', authHook({ db, clock, session: config.auth }));
      await api.register(authRoutes({ db, clock, config: config.auth }));
      await api.register(clubRoutes(db));
      await api.register(classRoutes({ db, clock }));
    },
    { prefix: '/api' },
  );

  return app;
}
