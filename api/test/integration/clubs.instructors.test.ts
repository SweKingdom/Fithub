import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { signInAs } from '../helpers/auth.js';
import { testDb } from '../helpers/db.js';
import { createClub, createUser } from '../helpers/factories.js';

type App = Awaited<ReturnType<typeof buildApp>>;

describe('GET /api/clubs/:clubId/instructors (US-120)', () => {
  const db = testDb();
  let app: App;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function setup() {
    const clubA = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const clubB = await createClub(db, { name: 'Club B', timezone: 'Europe/Stockholm' });
    const manager = await createUser(db, { role: 'club_manager', clubId: clubA.id });
    const member = await createUser(db, { role: 'member', clubId: clubA.id });
    const zed = await createUser(db, { role: 'instructor', clubId: clubA.id, fullName: 'Zed Zebra' });
    const amy = await createUser(db, { role: 'instructor', clubId: clubA.id, fullName: 'Amy Adams' });
    await createUser(db, { role: 'instructor', clubId: clubB.id, fullName: 'Other Club' });
    return { clubA, clubB, manager, member, zed, amy };
  }

  async function get(clubId: string, user?: { id: string }) {
    return app.inject({
      method: 'GET',
      url: `/api/clubs/${clubId}/instructors`,
      headers: user ? { cookie: await signInAs(app, user) } : {},
    });
  }

  it('lists only the instructors of the club, sorted by name, without e-mail addresses', async () => {
    const s = await setup();
    const res = await get(s.clubA.id, s.manager);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: s.amy.id, fullName: 'Amy Adams' },
      { id: s.zed.id, fullName: 'Zed Zebra' },
    ]);
  });

  it('answers 403 for another club', async () => {
    const s = await setup();
    const res = await get(s.clubB.id, s.manager);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      code: 'FORBIDDEN',
      message: 'You can only manage classes for your own club.',
    });
  });

  it('answers 403 for a member', async () => {
    const s = await setup();
    const res = await get(s.clubA.id, s.member);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      code: 'FORBIDDEN',
      message: 'Only instructors and club managers can manage classes.',
    });
  });

  it('answers 400 for a malformed club id', async () => {
    const s = await setup();
    const res = await get('not-a-uuid', s.manager);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      fieldErrors: [{ field: 'clubId', message: 'Choose a valid club.' }],
    });
  });

  it('answers 401 without a session', async () => {
    const s = await setup();
    const res = await get(s.clubA.id);
    expect(res.statusCode).toBe(401);
  });
});
