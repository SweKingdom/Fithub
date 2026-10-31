import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { signInAs } from '../helpers/auth.js';
import { testDb } from '../helpers/db.js';
import { createClub, createUser } from '../helpers/factories.js';

const T = new Date('2026-10-30T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const fixedClock = { now: () => T };
const clockAt = (offsetMs: number) => ({ now: () => new Date(T.getTime() + offsetMs) });
const auth = loadConfig({}).auth;

type App = Awaited<ReturnType<typeof buildApp>>;

interface RouteEntry {
  method: string | string[];
  url: string;
  public: boolean;
}

/** `/api` routes (without the automatic HEAD twins) as `{ method, url, public }`, one entry per method. */
function apiRoutes(app: App): { method: string; url: string; public: boolean }[] {
  return (app.routeTable as RouteEntry[])
    .filter((route) => route.url.startsWith('/api/'))
    .flatMap((route) =>
      (Array.isArray(route.method) ? route.method : [route.method]).map((method) => ({
        method,
        url: route.url,
        public: route.public,
      })),
    )
    .filter((route) => route.method !== 'HEAD');
}

describe('protection of /api (US-118)', () => {
  const db = testDb();
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ clock: fixedClock });
  });
  afterAll(async () => {
    await app.close();
  });

  async function newUser() {
    const club = await createClub(db, { name: `Club ${randomUUID()}`, timezone: 'Europe/Stockholm' });
    return createUser(db, { role: 'member', memberType: 'regular', clubId: club.id });
  }

  it('AC 3: the only public /api routes are sign-in and sign-out', () => {
    const publicRoutes = apiRoutes(app)
      .filter((route) => route.public)
      .map((route) => `${route.method} ${route.url}`)
      .sort();
    expect(publicRoutes).toEqual(['POST /api/auth/login', 'POST /api/auth/logout']);
  });

  it('AC 3: /api/me and /api/clubs are registered and protected', () => {
    const protectedRoutes = apiRoutes(app).filter((route) => !route.public);
    expect(protectedRoutes.map((route) => `${route.method} ${route.url}`)).toEqual(
      expect.arrayContaining(['GET /api/me', 'GET /api/clubs']),
    );
  });

  it('AC 3: every protected route answers 401 UNAUTHENTICATED without a valid session', async () => {
    const user = await newUser();
    // Idle: last active 13 hours ago (limit 12 hours).
    const idle = await signInAs(app, user, clockAt(-13 * HOUR));
    // Expired: older than the maximum age, but active just now, so only the age can reject it.
    const expired = await signInAs(app, user, clockAt(-(auth.sessionMaxAgeHours + 1) * HOUR));
    await db
      .updateTable('user_session')
      .set({ last_seen_at: T })
      .where('user_id', '=', user.id)
      .where('expires_at', '<=', T)
      .execute();

    const cookies: (string | undefined)[] = [undefined, 'fithub_session=unknown-token', idle, expired];
    const routes = apiRoutes(app).filter((route) => !route.public);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const url = route.url.replace(/:[A-Za-z_]+/g, () => randomUUID());
      for (const cookie of cookies) {
        const response = await app.inject({
          method: route.method as 'GET',
          url,
          headers: cookie ? { cookie } : {},
        });
        expect(response.statusCode, `${route.method} ${url} (${cookie ?? 'no cookie'})`).toBe(401);
        expect(response.json()).toEqual({ code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' });
      }
    }
  });

  it('AC 3: a valid session passes the hook', async () => {
    const user = await newUser();
    const cookie = await signInAs(app, user);
    const response = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(user.id);
  });

  it('AC 3: a session that was active within the idle window stays valid and is touched', async () => {
    const user = await newUser();
    const cookie = await signInAs(app, user, clockAt(-11 * HOUR));
    const response = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const rows = await db.selectFrom('user_session').selectAll().where('user_id', '=', user.id).execute();
    expect(rows[0].last_seen_at.getTime()).toBe(T.getTime());
  });

  it('AC 8: a state-changing request from another origin is refused with 403', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: '/api/auth/logout',
        headers: { origin: 'https://evil.example' },
      });
      expect(response.statusCode, method).toBe(403);
      expect(response.json()).toEqual({ code: 'FORBIDDEN', message: 'This request was blocked for security reasons.' });
    }
  });

  it('AC 8: the SPA origin and requests without an Origin header are not affected', async () => {
    const same = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: auth.appOrigin },
    });
    expect(same.statusCode).toBe(204);
    const none = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(none.statusCode).toBe(204);
  });

  it('AC 8: a read from another origin is not blocked by the origin guard', async () => {
    const user = await newUser();
    const cookie = await signInAs(app, user);
    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie, origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(200);
  });
});
