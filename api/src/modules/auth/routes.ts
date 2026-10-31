import '@fastify/cookie';
import '@fastify/rate-limit';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { AuthConfig } from '../../config.js';
import type { Clock } from '../../shared/clock.js';
import { DomainError } from '../../shared/errors.js';
import type { BlockService } from '../attendance/block-service.js';
import type { AuthDatabase } from './db-types.js';
import { currentUser, SESSION_COOKIE } from './hooks.js';
import { authenticate, buildMe, login, toAuthUser } from './service.js';
import { deleteSession } from './session.js';

export interface AuthRouteDeps {
  db: Kysely<AuthDatabase>;
  clock: Clock;
  config: AuthConfig;
  /** Supplies `bookingBlock` of `GET /me` (US-130). */
  blocks: Pick<BlockService, 'getActiveBlock'>;
}

const loginBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(['member', 'instructor', 'club_manager']),
  memberType: z.enum(['regular', 'drop_in']).nullable(),
  clubId: z.string().nullable(),
  clubName: z.string().nullable(),
  bookingBlock: z
    .object({
      endsAt: z.string(),
      reason: z.enum(['no_show', 'manual']),
      noShowCount: z.number().nullable(),
      message: z.string(),
    })
    .nullable(),
});

function cookieOptions(config: AuthConfig) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    path: '/api',
    secure: config.sessionCookieSecure,
  };
}

/**
 * `POST /auth/login`, `POST /auth/logout` and `GET /me`, registered inside the `/api` scope.
 * Login and logout are the only public routes.
 */
export function authRoutes(deps: AuthRouteDeps): FastifyPluginAsyncZod {
  const { db, clock, config, blocks } = deps;

  return async (app) => {
    app.post(
      '/auth/login',
      {
        config: {
          public: true,
          // Counted per email and client address before the password is checked (after body parsing).
          rateLimit: {
            max: config.loginRateLimitMax,
            timeWindow: config.loginRateLimitWindowMinutes * 60 * 1000,
            hook: 'preHandler',
            keyGenerator: (request: FastifyRequest) =>
              `${request.ip}:${(request.body as { email?: string } | undefined)?.email ?? ''}`,
            errorResponseBuilder: () =>
              new DomainError(
                'TOO_MANY_ATTEMPTS',
                `Too many sign-in attempts. Please wait ${config.loginRateLimitWindowMinutes} minutes and try again.`,
                429,
              ),
          },
        },
        schema: { body: loginBodySchema, response: { 200: meSchema } },
      },
      async (request, reply) => {
        const { email, password } = request.body;
        const user = await authenticate(db, email, password, config);
        if (!user) {
          // No email, password or cookie in the log.
          request.log.warn({ ip: request.ip }, 'auth.login_failed');
          throw new DomainError('INVALID_CREDENTIALS', 'Email or password is incorrect.', 401);
        }

        const session = await login(
          db,
          user,
          clock.now(),
          config,
          request.cookies[SESSION_COOKIE],
        );
        void reply.setCookie(SESSION_COOKIE, session.token, {
          ...cookieOptions(config),
          maxAge: config.sessionMaxAgeHours * 3600,
        });
        void reply.header('Cache-Control', 'no-store');
        request.log.info({ userId: user.id }, 'auth.login_succeeded');
        return buildMe(db, toAuthUser(user), blocks);
      },
    );

    app.post('/auth/logout', { config: { public: true } }, async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      if (token) await deleteSession(db, token);
      return clearSessionCookie(reply, config).code(204).send();
    });

    app.get('/me', { schema: { response: { 200: meSchema } } }, async (request, reply) => {
      void reply.header('Cache-Control', 'no-store');
      return buildMe(db, currentUser(request), blocks);
    });
  };
}

/** Expires the cookie with the same attributes it was set with. */
function clearSessionCookie(reply: FastifyReply, config: AuthConfig): FastifyReply {
  return reply.setCookie(SESSION_COOKIE, '', { ...cookieOptions(config), maxAge: 0, expires: new Date(0) });
}
