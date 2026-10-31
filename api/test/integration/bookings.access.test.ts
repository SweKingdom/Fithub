import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { signInAs } from '../helpers/auth.js';
import { testDb } from '../helpers/db.js';
import { createBooking, createClass, createClub, createUser } from '../helpers/factories.js';

const START = new Date('2026-10-30T09:00:00.000Z');
const NOW = new Date(START.getTime() + 10 * 60 * 1000);

type App = Awaited<ReturnType<typeof buildApp>>;

/**
 * Access matrix: one row per route × actor. Club-scoped class management routes only for now
 * (US-129); the member-owned booking routes join the matrix with US-123.
 */
describe('access matrix (US-129): GET/PUT /api/classes/:classId/attendance', () => {
  const db = testDb();
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ clock: { now: () => NOW } });
  });
  afterAll(async () => {
    await app.close();
  });

  async function scenario() {
    const club = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const other = await createClub(db, { name: 'Club B', timezone: 'Europe/Stockholm' });
    const gymClass = await createClass(db, { clubId: club.id, startAt: START });
    const member = await createUser(db, { role: 'member', clubId: club.id });
    const booking = await createBooking(db, { classId: gymClass.id, memberId: member.id, status: 'confirmed' });
    const actors = {
      'member of the club': await createUser(db, { role: 'member', clubId: club.id }),
      'instructor of the club': await createUser(db, { role: 'instructor', clubId: club.id }),
      'club manager of the club': await createUser(db, { role: 'club_manager', clubId: club.id }),
      'instructor of another club': await createUser(db, { role: 'instructor', clubId: other.id }),
      'club manager of another club': await createUser(db, { role: 'club_manager', clubId: other.id }),
    };
    return { gymClass, booking, actors };
  }

  const expectations: [string, number][] = [
    ['member of the club', 403],
    ['instructor of the club', 200],
    ['club manager of the club', 200],
    ['instructor of another club', 403],
    ['club manager of another club', 403],
  ];

  it.each(['GET', 'PUT'] as const)('%s: one status per actor', async (method) => {
    const { gymClass, booking, actors } = await scenario();
    const request = async (cookie?: string) =>
      app.inject({
        method,
        url: `/api/classes/${gymClass.id}/attendance`,
        headers: cookie ? { cookie } : {},
        payload: method === 'PUT' ? { entries: [{ bookingId: booking.id, attendance: 'attended' }] } : undefined,
      });

    expect((await request()).statusCode).toBe(401);
    for (const [actor, status] of expectations) {
      const user = actors[actor as keyof typeof actors];
      const cookie = await signInAs(app, user, { now: () => NOW });
      expect((await request(cookie)).statusCode, `${method} as ${actor}`).toBe(status);
    }
  });

  it('an unknown class is 404 for staff and 401 for anonymous callers', async () => {
    const { actors } = await scenario();
    const url = `/api/classes/${randomUUID()}/attendance`;
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    const cookie = await signInAs(app, actors['instructor of the club'], { now: () => NOW });
    expect((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode).toBe(404);
  });
});
