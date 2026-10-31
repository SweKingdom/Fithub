import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { authHook, currentUser, originGuard, requireRole } from '../../src/modules/auth/hooks.js';
import { systemClock } from '../../src/shared/clock.js';
import { registerErrorHandler } from '../../src/shared/errors.js';
import { signInAs } from '../helpers/auth.js';
import { testDb } from '../helpers/db.js';
import { createClub, createUser } from '../helpers/factories.js';

const STAFF_MESSAGE = 'Only instructors and club managers can manage classes.';
const auth = loadConfig({}).auth;

/** The real hooks and error handler on a tiny app with two guarded test routes inside an `/api` scope. */
async function buildGuardedApp(onHandler: (userId: string) => void) {
  const db = testDb();
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(cookie);
  await app.register(
    async (api) => {
      api.addHook('onRequest', originGuard(auth.appOrigin));
      api.addHook('onRequest', authHook({ db, clock: systemClock, session: auth }));
      api.post(
        '/guarded',
        { preHandler: requireRole(['instructor', 'club_manager'], STAFF_MESSAGE) },
        async (request) => {
          onHandler(currentUser(request).id);
          return { ok: true };
        },
      );
      api.post('/guarded-default', { preHandler: requireRole(['club_manager']) }, async (request) => {
        onHandler(currentUser(request).id);
        return { ok: true };
      });
    },
    { prefix: '/api' },
  );
  await app.ready();
  return app;
}

describe('role enforcement (US-118)', () => {
  const db = testDb();
  const handled: string[] = [];
  let app: Awaited<ReturnType<typeof buildGuardedApp>>;

  beforeAll(async () => {
    app = await buildGuardedApp((userId) => handled.push(userId));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    handled.length = 0;
  });

  async function userWithRole(role: 'member' | 'instructor' | 'club_manager') {
    const club = await createClub(db, { name: `Club ${randomUUID()}`, timezone: 'Europe/Stockholm' });
    const user =
      role === 'member'
        ? await createUser(db, { role, memberType: 'regular', clubId: club.id })
        : await createUser(db, { role, clubId: club.id });
    return { user, sessionCookie: await signInAs(app, user) };
  }

  it('AC 4: a member gets 403 FORBIDDEN with the guard message and the handler does not run', async () => {
    const { sessionCookie } = await userWithRole('member');
    const response = await app.inject({ method: 'POST', url: '/api/guarded', headers: { cookie: sessionCookie } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: 'FORBIDDEN', message: STAFF_MESSAGE });
    expect(handled).toEqual([]);
  });

  it('AC 4: without a custom message the text is the default', async () => {
    const { sessionCookie } = await userWithRole('instructor');
    const response = await app.inject({
      method: 'POST',
      url: '/api/guarded-default',
      headers: { cookie: sessionCookie },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: 'FORBIDDEN', message: "You don't have permission to do this." });
    expect(handled).toEqual([]);
  });

  it.each(['instructor', 'club_manager'] as const)('AC 5: a %s reaches the handler', async (role) => {
    const { user, sessionCookie } = await userWithRole(role);
    const response = await app.inject({ method: 'POST', url: '/api/guarded', headers: { cookie: sessionCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(handled).toEqual([user.id]);
  });

  it('an unauthenticated caller gets 401 before the role is checked', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/guarded' });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
    expect(handled).toEqual([]);
  });
});
