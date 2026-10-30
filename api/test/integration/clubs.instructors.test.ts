import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { signInAs } from '../helpers/auth.js';
import { getTestDb, resetDb } from '../helpers/db.js';
import { createClub, createUser } from '../helpers/factories.js';

const db = getTestDb();
let app: FastifyInstance;

describe('GET /api/clubs/:clubId/instructors', () => {
  beforeEach(async () => {
    await resetDb(db);
    app = buildApp({ config: loadConfig(process.env), db });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
  });

  async function setup() {
    const clubA = await createClub();
    const clubB = await createClub();
    const manager = await createUser({ role: 'club_manager', clubId: clubA.id });
    const member = await createUser({ role: 'member', clubId: clubA.id });
    const zed = await createUser({ role: 'instructor', clubId: clubA.id, fullName: 'Zed Zebra' });
    const amy = await createUser({ role: 'instructor', clubId: clubA.id, fullName: 'Amy Adams' });
    await createUser({ role: 'instructor', clubId: clubB.id, fullName: 'Other Club' });
    return { clubA, clubB, manager, member, zed, amy };
  }

  it('lists only the instructors of the club, sorted by name, without e-mail addresses', async () => {
    const s = await setup();
    const res = await app.inject({
      method: 'GET',
      url: `/api/clubs/${s.clubA.id}/instructors`,
      headers: await signInAs(app, s.manager),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: s.amy.id, fullName: 'Amy Adams' },
      { id: s.zed.id, fullName: 'Zed Zebra' },
    ]);
  });

  it('answers 403 for another club', async () => {
    const s = await setup();
    const res = await app.inject({
      method: 'GET',
      url: `/api/clubs/${s.clubB.id}/instructors`,
      headers: await signInAs(app, s.manager),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      code: 'FORBIDDEN',
      message: 'You can only manage classes for your own club.',
    });
  });

  it('answers 403 for a member', async () => {
    const s = await setup();
    const res = await app.inject({
      method: 'GET',
      url: `/api/clubs/${s.clubA.id}/instructors`,
      headers: await signInAs(app, s.member),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      code: 'FORBIDDEN',
      message: 'Only instructors and club managers can manage classes.',
    });
  });

  it('answers 400 for a malformed club id', async () => {
    const s = await setup();
    const res = await app.inject({
      method: 'GET',
      url: '/api/clubs/not-a-uuid/instructors',
      headers: await signInAs(app, s.manager),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      fieldErrors: [{ field: 'clubId', message: 'Choose a valid club.' }],
    });
  });

  it('answers 401 without a session', async () => {
    const s = await setup();
    const res = await app.inject({ method: 'GET', url: `/api/clubs/${s.clubA.id}/instructors` });
    expect(res.statusCode).toBe(401);
  });
});
