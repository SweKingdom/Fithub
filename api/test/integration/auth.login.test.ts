import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { loginViaApi, signInAs } from '../helpers/auth.js';
import { testDb } from '../helpers/db.js';
import { createClub, createUser } from '../helpers/factories.js';

const T = new Date('2026-10-30T09:00:00.000Z');
const PASSWORD = 'correct-horse-battery';
const fixedClock = { now: () => T };

type App = Awaited<ReturnType<typeof buildApp>>;

function setCookieOf(response: { headers: Record<string, unknown> }): string | undefined {
  const header = response.headers['set-cookie'];
  return Array.isArray(header) ? (header[0] as string) : (header as string | undefined);
}

describe('sign-in and sign-out (US-118)', () => {
  const db = testDb();
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ clock: fixedClock });
  });
  afterAll(async () => {
    await app.close();
  });

  async function setupStaff() {
    const club = await createClub(db, { name: `Club ${randomUUID()}`, timezone: 'Europe/Stockholm' });
    const email = `anna-${randomUUID()}@example.com`;
    const user = await createUser(db, { role: 'instructor', clubId: club.id, email, password: PASSWORD });
    return { club, email, user };
  }

  async function sessionsOf(userId: string) {
    return db.selectFrom('user_session').selectAll().where('user_id', '=', userId).execute();
  }

  it('AC 1: signs in, sets a hardened cookie, stores only the token hash and GET /api/me returns the user', async () => {
    const { club, email, user } = await setupStaff();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: `  ${email.toUpperCase()} `, password: PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    const me = response.json();
    expect(me).toEqual({
      id: user.id,
      email,
      fullName: expect.any(String),
      role: 'instructor',
      memberType: null,
      clubId: club.id,
      clubName: club.name,
      bookingBlock: null,
    });

    const cookie = setCookieOf(response) as string;
    expect(cookie).toMatch(/^fithub_session=/);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Strict/);
    expect(cookie).toMatch(/; Path=\/api/);
    expect(cookie).toMatch(/; Max-Age=604800/);
    expect(cookie).not.toMatch(/; Secure/);

    const token = cookie.split(';')[0].slice('fithub_session='.length);
    const rows = await sessionsOf(user.id);
    expect(rows).toHaveLength(1);
    expect(Buffer.compare(rows[0].token_hash, createHash('sha256').update(token).digest())).toBe(0);
    expect(rows[0].token_hash.toString('utf8')).not.toContain(token);

    const profile = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `fithub_session=${token}` } });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toEqual(me);
    expect(profile.headers['cache-control']).toBe('no-store');
  });

  it('AC 1: marks the cookie Secure when SESSION_COOKIE_SECURE=true', async () => {
    const secureApp = await buildApp({
      clock: fixedClock,
      config: loadConfig({ ...process.env, SESSION_COOKIE_SECURE: 'true' }),
    });
    try {
      const { email } = await setupStaff();
      const response = await secureApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: PASSWORD },
      });
      expect(response.statusCode).toBe(200);
      expect(setCookieOf(response)).toMatch(/; Secure/);
    } finally {
      await secureApp.close();
    }
  });

  it('AC 2: wrong password, unknown email and an account without a password get the same 401 and no session', async () => {
    const { club, email, user } = await setupStaff();
    const noPasswordEmail = `nopass-${randomUUID()}@example.com`;
    const noPassword = await createUser(db, { role: 'member', memberType: 'regular', clubId: club.id, email: noPasswordEmail });

    const attempts = [
      { email, password: 'wrong-password-123' },
      { email: `unknown-${randomUUID()}@example.com`, password: PASSWORD },
      { email: noPasswordEmail, password: PASSWORD },
    ];
    const bodies = [];
    for (const payload of attempts) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload });
      expect(response.statusCode).toBe(401);
      expect(setCookieOf(response)).toBeUndefined();
      bodies.push(response.json());
    }
    for (const body of bodies) {
      expect(body).toEqual({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
    }
    expect(await sessionsOf(user.id)).toHaveLength(0);
    expect(await sessionsOf(noPassword.id)).toHaveLength(0);
  });

  it.each([
    ['missing password', { email: 'a@example.com' }, 'password'],
    ['missing email', { password: PASSWORD }, 'email'],
    ['malformed email', { email: 'not-an-email', password: PASSWORD }, 'email'],
    ['empty password', { email: 'a@example.com', password: '' }, 'password'],
  ])('AC 2: %s → 400 VALIDATION_ERROR with fieldErrors', async (_name, payload, field) => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
    expect(response.json().fieldErrors.map((e: { field: string }) => e.field)).toContain(field);
    expect(setCookieOf(response)).toBeUndefined();
  });

  it('signing in again replaces the token of the incoming cookie (no session fixation)', async () => {
    const { email, user } = await setupStaff();
    const first = await loginViaApi(app, email, PASSWORD);
    expect(first.cookie).not.toBeNull();

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { cookie: first.cookie as string },
      payload: { email, password: PASSWORD },
    });
    expect(second.statusCode).toBe(200);
    expect(await sessionsOf(user.id)).toHaveLength(1);

    const old = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: first.cookie as string } });
    expect(old.statusCode).toBe(401);
  });

  it('AC 6: sign-out deletes the session, clears the cookie and the old cookie gets 401', async () => {
    const { email, user } = await setupStaff();
    const { cookie } = await loginViaApi(app, email, PASSWORD);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: cookie as string },
    });
    expect(response.statusCode).toBe(204);
    expect(setCookieOf(response)).toMatch(/Max-Age=0/);
    expect(await sessionsOf(user.id)).toHaveLength(0);

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: cookie as string } });
    expect(me.statusCode).toBe(401);
  });

  it('AC 6: sign-out without a cookie is 204 as well', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(response.statusCode).toBe(204);
  });

  it('AC 6: sign-out keeps the sessions of the same user on other devices', async () => {
    const { user } = await setupStaff();
    const first = await signInAs(app, user);
    const second = await signInAs(app, user);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: first } });
    const other = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: second } });
    expect(other.statusCode).toBe(200);
  });

  it('AC 9: no password, token or cookie header reaches the log during a sign-in', async () => {
    const lines: string[] = [];
    const loggedApp = await buildApp({
      clock: fixedClock,
      logger: { level: 'info', stream: { write: (line: string) => void lines.push(line) } },
    });
    try {
      const { email } = await setupStaff();
      const ok = await loggedApp.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
      const token = (setCookieOf(ok) as string).split(';')[0].slice('fithub_session='.length);
      await loggedApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { cookie: `fithub_session=${token}` },
        payload: { email, password: 'wrong-password-123' },
      });

      const log = lines.join('\n');
      expect(log).toContain('auth.login_succeeded');
      expect(log).toContain('auth.login_failed');
      expect(log).not.toContain(PASSWORD);
      expect(log).not.toContain('wrong-password-123');
      expect(log).not.toContain(token);
      expect(log).not.toContain(email);
    } finally {
      await loggedApp.close();
    }
  });

  it('AC 9: the response never contains the password, its hash or the token', async () => {
    const { email } = await setupStaff();
    const { response, cookie } = await loginViaApi(app, email, PASSWORD);
    const token = (cookie as string).slice('fithub_session='.length);
    expect(response.body).not.toContain(token);
    expect(response.body).not.toContain('scrypt$');
    expect(response.body).not.toContain(PASSWORD);
  });
});

describe('sign-in rate limit (US-118 AC 7)', () => {
  const db = testDb();
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ clock: fixedClock, config: loadConfig({ ...process.env, LOGIN_RATE_LIMIT_MAX: '3' }) });
  });
  afterAll(async () => {
    await app.close();
  });

  async function attempt(email: string, password: string) {
    return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  }

  it('refuses the attempt after the limit without checking the password, per email', async () => {
    const club = await createClub(db, { name: `Club ${randomUUID()}`, timezone: 'Europe/Stockholm' });
    const email = `limit-${randomUUID()}@example.com`;
    const user = await createUser(db, { role: 'instructor', clubId: club.id, email, password: PASSWORD });

    for (let i = 0; i < 3; i += 1) {
      expect((await attempt(email, 'wrong-password-123')).statusCode).toBe(401);
    }
    const blocked = await attempt(email, PASSWORD);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({
      code: 'TOO_MANY_ATTEMPTS',
      message: 'Too many sign-in attempts. Please wait 15 minutes and try again.',
    });
    expect(blocked.headers['set-cookie']).toBeUndefined();
    expect(await db.selectFrom('user_session').selectAll().where('user_id', '=', user.id).execute()).toHaveLength(0);

    // Another email from the same address is not affected.
    const other = await attempt(`other-${randomUUID()}@example.com`, 'wrong-password-123');
    expect(other.statusCode).toBe(401);
  });
});
