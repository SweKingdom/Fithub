import '@fastify/cookie';
import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import type { Kysely } from 'kysely';
import type { Clock } from '../../shared/clock.js';
import { forbidden, unauthenticated } from '../../shared/errors.js';
import type { AuthDatabase } from './db-types.js';
import { resolveSession, type SessionConfig } from './session.js';
import type { AuthUser, Role } from './types.js';

export const SESSION_COOKIE = 'fithub_session';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface AuthHookDeps {
  db: Kysely<AuthDatabase>;
  clock: Clock;
  session: SessionConfig;
}

/**
 * `onRequest` hook of the `/api` scope (ADR-015): every route needs a valid session unless it
 * declares `config: { public: true }`. Sets `request.user`; the route handler never runs otherwise.
 */
export function authHook(deps: AuthHookDeps): onRequestAsyncHookHandler {
  return async (request) => {
    if (request.routeOptions.config?.public === true) return;
    const token = request.cookies[SESSION_COOKIE];
    if (!token) throw unauthenticated();
    const user = await resolveSession(deps.db, token, deps.clock.now(), deps.session);
    if (!user) throw unauthenticated();
    request.user = user;
  };
}

/**
 * `onRequest` hook of the `/api` scope: a state-changing request whose `Origin` header is present and
 * differs from the SPA's origin is refused. Requests without `Origin` are not affected.
 */
export function originGuard(appOrigin: string): onRequestAsyncHookHandler {
  return async (request) => {
    if (!STATE_CHANGING_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== appOrigin) {
      throw forbidden('This request was blocked for security reasons.');
    }
  };
}

/**
 * Route guard: only the listed roles pass. Use as `preValidation` (before the body is validated) or `preHandler`.
 *
 * @example api.post('/classes', { preHandler: requireRole(['instructor', 'club_manager'], 'Only instructors and club managers can manage classes.') }, handler)
 */
export function requireRole(
  roles: Role[],
  message?: string,
): (request: FastifyRequest) => Promise<void> {
  return async (request) => {
    const user = currentUser(request);
    if (!roles.includes(user.role)) throw forbidden(message);
  };
}

/** The signed-in user. Services take the caller's id, role and club from here, never from the request body. */
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw unauthenticated();
  return request.user;
}
