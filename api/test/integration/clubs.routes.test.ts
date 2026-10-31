import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { signInAs } from '../helpers/auth.js';
import { testDb } from '../helpers/db.js';
import { createClub, createUser } from '../helpers/factories.js';

describe('GET /api/clubs and GET /health (US-117, US-118)', () => {
  const db = testDb();
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /api/clubs without a session is 401 UNAUTHENTICATED', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/clubs' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' });
  });

  it('GET /api/clubs for a signed-in user lists the clubs sorted by name', async () => {
    const suffix = randomUUID();
    const second = await createClub(db, { name: `Zeta ${suffix}`, timezone: 'Europe/Stockholm' });
    const first = await createClub(db, { name: `Alpha ${suffix}`, timezone: 'Europe/Stockholm' });
    const member = await createUser(db, { role: 'member', memberType: 'regular' });
    const cookie = await signInAs(app, member);

    const response = await app.inject({ method: 'GET', url: '/api/clubs', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const ids = (response.json() as { id: string }[]).map((club) => club.id);
    expect(ids.indexOf(first.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    expect(response.json()).toContainEqual({ id: first.id, name: first.name, timezone: 'Europe/Stockholm' });
  });

  it('GET /health needs no session and reports the database', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', db: 'ok' });
  });

  it('an unknown route answers 404 NOT_FOUND', async () => {
    const response = await app.inject({ method: 'GET', url: '/nothing-here' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'NOT_FOUND', message: 'This page or resource does not exist.' });
  });
});
