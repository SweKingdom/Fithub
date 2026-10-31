import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { signInAs } from '../helpers/auth.js';
import { testDb } from '../helpers/db.js';
import { createBooking, createClass, createClub, createUser } from '../helpers/factories.js';

const T = new Date('2026-10-30T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const RANDOM_ID = '00000000-0000-4000-8000-000000000000';

type App = Awaited<ReturnType<typeof buildApp>>;
type Actor = 'memberA' | 'staffA' | 'staffB' | 'anonymous';

interface World {
  cookies: Record<Exclude<Actor, 'anonymous'>, string>;
  bookingA: string; // memberA, class of club A
  bookingB: string; // memberB, class of club A
  bookingC: string; // memberC, class of club B
  classA: string;
  classB: string;
}

/** One row per booking route (later stories add rows for their routes). */
const MATRIX: {
  name: string;
  method: 'GET' | 'POST';
  url: (w: World) => string;
  actor: Actor;
  status: number;
  code: string | null;
}[] = [
  { name: 'me/bookings as signed-out caller', method: 'GET', url: () => '/api/me/bookings', actor: 'anonymous', status: 401, code: 'UNAUTHENTICATED' },
  { name: 'me/bookings as staff', method: 'GET', url: () => '/api/me/bookings', actor: 'staffA', status: 403, code: 'FORBIDDEN' },
  { name: 'me/bookings as a member (own bookings only)', method: 'GET', url: () => '/api/me/bookings', actor: 'memberA', status: 200, code: null },
  { name: 'booking of another member', method: 'GET', url: (w) => `/api/bookings/${w.bookingB}`, actor: 'memberA', status: 404, code: 'BOOKING_NOT_FOUND' },
  { name: 'booking of another club as staff', method: 'GET', url: (w) => `/api/bookings/${w.bookingC}`, actor: 'staffA', status: 404, code: 'BOOKING_NOT_FOUND' },
  { name: 'booking with an unknown id', method: 'GET', url: () => `/api/bookings/${RANDOM_ID}`, actor: 'memberA', status: 404, code: 'BOOKING_NOT_FOUND' },
  { name: 'booking as signed-out caller', method: 'GET', url: (w) => `/api/bookings/${w.bookingA}`, actor: 'anonymous', status: 401, code: 'UNAUTHENTICATED' },
  { name: 'cancel booking of another member', method: 'POST', url: (w) => `/api/bookings/${w.bookingB}/cancel`, actor: 'memberA', status: 404, code: 'BOOKING_NOT_FOUND' },
  { name: 'cancel with an unknown id', method: 'POST', url: () => `/api/bookings/${RANDOM_ID}/cancel`, actor: 'memberA', status: 404, code: 'BOOKING_NOT_FOUND' },
  { name: 'cancel as staff of the same club', method: 'POST', url: (w) => `/api/bookings/${w.bookingB}/cancel`, actor: 'staffA', status: 403, code: 'FORBIDDEN' },
  { name: 'cancel as staff of another club', method: 'POST', url: (w) => `/api/bookings/${w.bookingA}/cancel`, actor: 'staffB', status: 403, code: 'FORBIDDEN' },
  { name: 'cancel as signed-out caller', method: 'POST', url: (w) => `/api/bookings/${w.bookingA}/cancel`, actor: 'anonymous', status: 401, code: 'UNAUTHENTICATED' },
  { name: 'roster of another club', method: 'GET', url: (w) => `/api/classes/${w.classB}/bookings`, actor: 'staffA', status: 403, code: 'FORBIDDEN' },
  { name: 'roster as a member', method: 'GET', url: (w) => `/api/classes/${w.classA}/bookings`, actor: 'memberA', status: 403, code: 'FORBIDDEN' },
  { name: 'roster as signed-out caller', method: 'GET', url: (w) => `/api/classes/${w.classA}/bookings`, actor: 'anonymous', status: 401, code: 'UNAUTHENTICATED' },
];

describe('booking access (US-123)', () => {
  let app: App;
  let world: World;
  const db = testDb();

  beforeAll(async () => {
    app = await buildApp({ clock: { now: () => T } });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await db.deleteFrom('booking').execute();
    await db.deleteFrom('gym_class').execute();
    const clubA = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const clubB = await createClub(db, { name: 'Club B', timezone: 'Europe/Stockholm' });
    const memberA = await createUser(db, { role: 'member', clubId: clubA.id });
    const memberB = await createUser(db, { role: 'member', clubId: clubA.id, fullName: 'Member B' });
    const memberC = await createUser(db, { role: 'member', clubId: clubB.id });
    const staffA = await createUser(db, { role: 'club_manager', clubId: clubA.id });
    const staffB = await createUser(db, { role: 'instructor', clubId: clubB.id });
    const classA = await createClass(db, { clubId: clubA.id, startAt: new Date(T.getTime() + 3 * HOUR) });
    const classB = await createClass(db, { clubId: clubB.id, startAt: new Date(T.getTime() + 3 * HOUR) });
    world = {
      cookies: {
        memberA: await signInAs(app, memberA),
        staffA: await signInAs(app, staffA),
        staffB: await signInAs(app, staffB),
      },
      bookingA: (await createBooking(db, { classId: classA.id, memberId: memberA.id, status: 'confirmed' })).id,
      bookingB: (await createBooking(db, { classId: classA.id, memberId: memberB.id, status: 'confirmed' })).id,
      bookingC: (await createBooking(db, { classId: classB.id, memberId: memberC.id, status: 'confirmed' })).id,
      classA: classA.id,
      classB: classB.id,
    };
  });

  const snapshot = async () => JSON.stringify(await db.selectFrom('booking').selectAll().orderBy('id').execute());

  function request(method: 'GET' | 'POST', url: string, actor: Actor) {
    return app.inject({
      method,
      url,
      headers: actor === 'anonymous' ? {} : { cookie: world.cookies[actor] },
    });
  }

  describe.each(MATRIX)('AC 6: $method $name', (row) => {
    it(`answers ${row.status}${row.code ? ` ${row.code}` : ''} and changes nothing`, async () => {
      const before = await snapshot();
      const res = await request(row.method, row.url(world), row.actor);
      expect(res.statusCode).toBe(row.status);
      if (row.code) expect(res.json().code).toBe(row.code);
      expect(await snapshot()).toBe(before);
    });
  });

  it('AC 6: a member list never contains another member’s or another club’s booking', async () => {
    const res = await request('GET', '/api/me/bookings', 'memberA');
    const ids = (res.json() as { items: { id: string }[] }).items.map((i) => i.id);
    expect(ids).toEqual([world.bookingA]);
  });

  it('AC 3: another member’s booking and a random id give the identical 404 body', async () => {
    const foreign = await request('GET', `/api/bookings/${world.bookingB}`, 'memberA');
    const random = await request('GET', `/api/bookings/${RANDOM_ID}`, 'memberA');
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).toBe(random.body);
    expect(foreign.json()).toEqual({ code: 'BOOKING_NOT_FOUND', message: 'This booking does not exist.' });
  });

  it('AC 4: cancelling another member’s booking is a 404 and leaves their booking active', async () => {
    const res = await request('POST', `/api/bookings/${world.bookingB}/cancel`, 'memberA');
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('BOOKING_NOT_FOUND');
    const row = await db.selectFrom('booking').select('status').where('id', '=', world.bookingB).executeTakeFirstOrThrow();
    expect(row.status).toBe('confirmed');
  });

  it('AC 4: a member can cancel their own booking once; a second attempt is a 409', async () => {
    const first = await request('POST', `/api/bookings/${world.bookingA}/cancel`, 'memberA');
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ id: world.bookingA, status: 'cancelled', canCancel: false });
    const second = await request('POST', `/api/bookings/${world.bookingA}/cancel`, 'memberA');
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('BOOKING_ALREADY_CANCELLED');
  });
});
