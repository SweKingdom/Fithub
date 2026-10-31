import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  beforeEach(async () => {
    await sql`TRUNCATE club CASCADE`.execute(db);
  });

  async function memberCookie(): Promise<string> {
    const member = await createUser(db, { role: 'member', memberType: 'regular' });
    return signInAs(app, member);
  }

  it('GET /api/clubs without a session is 401 UNAUTHENTICATED', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/clubs' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' });
  });

  it('AC 6: returns an empty array when there are no clubs', async () => {
    const cookie = await memberCookie();
    const response = await app.inject({ method: 'GET', url: '/api/clubs', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('AC 6: lists all clubs sorted by name with only id, code, name and timezone', async () => {
    await createClub(db, { code: 'ZED', name: 'Zed Club', timezone: 'UTC' });
    await createClub(db, { code: 'ALPHA', name: 'Alpha Club', timezone: 'Europe/Stockholm' });
    await createClub(db, { code: 'MID', name: 'Mid Club', timezone: 'Europe/London' });
    const cookie = await memberCookie();

    const response = await app.inject({ method: 'GET', url: '/api/clubs', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const body = response.json<Array<Record<string, string>>>();
    expect(body.map((club) => club.name)).toEqual(['Alpha Club', 'Mid Club', 'Zed Club']);
    expect(body.map((club) => club.code)).toEqual(['ALPHA', 'MID', 'ZED']);
    expect(body.map((club) => club.timezone)).toEqual(['Europe/Stockholm', 'Europe/London', 'UTC']);
    for (const club of body) {
      expect(Object.keys(club).sort()).toEqual(['code', 'id', 'name', 'timezone']);
      expect(club.id).toMatch(/^[0-9a-f-]{36}$/);
    }
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
