import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../src/config.js';
import { SESSION_COOKIE } from '../../src/modules/auth/hooks.js';
import { createSession } from '../../src/modules/auth/session.js';
import { systemClock, type Clock } from '../../src/shared/clock.js';
import { testDb } from './db.js';

/**
 * Inserts a session for `user` directly (no scrypt, fast) and returns the value for the `cookie` header.
 * `clock` sets when the session was created; the default is the real time.
 */
export async function signInAs(
  _app: FastifyInstance,
  user: { id: string },
  clock: Clock = systemClock,
): Promise<string> {
  const { token } = await createSession(testDb(), user.id, clock.now(), loadConfig({}).auth);
  return `${SESSION_COOKIE}=${token}`;
}

/** Signs in through the real endpoint; `cookie` is null when no session cookie was set. */
export async function loginViaApi(app: FastifyInstance, email: string, password: string) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  const header = response.headers['set-cookie'];
  const raw = Array.isArray(header) ? header[0] : header;
  return { response, cookie: raw ? raw.split(';')[0] : null };
}
