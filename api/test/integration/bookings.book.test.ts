import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { signInAs } from '../helpers/auth.js';
import { testDb } from '../helpers/db.js';
import { createBooking, createClass, createClub, createUser } from '../helpers/factories.js';

const T = new Date('2026-10-30T09:00:00.000Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (offsetMs: number): Date => new Date(T.getTime() + offsetMs);
const fixedClock = (now: Date) => ({ now: () => now });

type App = Awaited<ReturnType<typeof buildApp>>;

describe('POST /api/classes/:classId/bookings (US-122)', () => {
  let app: App;
  const db = testDb();

  beforeAll(async () => {
    app = await buildApp({ clock: fixedClock(T) });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await db.deleteFrom('booking').execute();
    await db.deleteFrom('gym_class').execute();
  });

  async function book(classId: string, cookie?: string) {
    return app.inject({
      method: 'POST',
      url: `/api/classes/${classId}/bookings`,
      headers: cookie ? { cookie } : {},
    });
  }

  async function setup(memberType: 'regular' | 'drop_in' = 'regular') {
    const club = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const member = await createUser(db, { role: 'member', clubId: club.id, memberType });
    const cookie = await signInAs(app, member);
    return { club, member, cookie };
  }

  async function activeCount(classId: string): Promise<number> {
    const rows = await db
      .selectFrom('booking')
      .select('id')
      .where('class_id', '=', classId)
      .where('status', 'in', ['confirmed', 'pending_payment'])
      .execute();
    return rows.length;
  }

  async function bookingsOf(classId: string, memberId: string) {
    return db.selectFrom('booking').selectAll().where('class_id', '=', classId).where('member_id', '=', memberId).execute();
  }

  it('AC 1: a regular member gets a confirmed booking, 201 and a Location header', async () => {
    const { club, member, cookie } = await setup();
    const cls = await createClass(db, { clubId: club.id, startAt: at(DAY), capacity: 5 });

    const res = await book(cls.id, cookie);

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(res.headers.location).toBe(`/api/bookings/${body.id}`);
    expect(body).toMatchObject({
      type: 'booking',
      memberId: member.id,
      classId: cls.id,
      status: 'confirmed',
      attendance: 'unknown',
      source: 'direct',
      bookedAt: T.toISOString(),
      cancelledAt: null,
      canCancel: true,
    });
    const rows = await bookingsOf(cls.id, member.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: body.id, status: 'confirmed', attendance: 'unknown', source: 'direct' });
    expect(rows[0].booked_at).toEqual(T);
    expect(await activeCount(cls.id)).toBe(1);
  });

  it('AC 2: booking the same class twice is rejected with ALREADY_BOOKED', async () => {
    const { club, member, cookie } = await setup();
    const cls = await createClass(db, { clubId: club.id, startAt: at(DAY), capacity: 5 });
    expect((await book(cls.id, cookie)).statusCode).toBe(201);

    const res = await book(cls.id, cookie);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'ALREADY_BOOKED', message: 'You have already booked this class.' });
    expect(await bookingsOf(cls.id, member.id)).toHaveLength(1);
  });

  it('AC 2: five parallel requests by one member give one 201 and four ALREADY_BOOKED', async () => {
    const { club, member, cookie } = await setup();
    const cls = await createClass(db, { clubId: club.id, startAt: at(DAY), capacity: 5 });

    const results = await Promise.all(Array.from({ length: 5 }, () => book(cls.id, cookie)));

    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    const rejected = results.filter((r) => r.statusCode === 409);
    expect(rejected).toHaveLength(4);
    expect(rejected.every((r) => r.json().code === 'ALREADY_BOOKED')).toBe(true);
    expect(await activeCount(cls.id)).toBe(1);
    expect(await bookingsOf(cls.id, member.id)).toHaveLength(1);
  });

  it('AC 2: a full class the member already booked gives ALREADY_BOOKED, not CLASS_FULL', async () => {
    const { club, member, cookie } = await setup();
    const cls = await createClass(db, { clubId: club.id, startAt: at(DAY), capacity: 1 });
    await createBooking(db, { classId: cls.id, memberId: member.id, status: 'confirmed' });

    const res = await book(cls.id, cookie);

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ALREADY_BOOKED');
  });

  it('AC 3: a full class is rejected with CLASS_FULL and nothing is stored', async () => {
    const { club, member, cookie } = await setup();
    const cls = await createClass(db, { clubId: club.id, startAt: at(DAY), capacity: 2 });
    for (const status of ['confirmed', 'pending_payment'] as const) {
      const other = await createUser(db, { role: 'member', clubId: club.id });
      await createBooking(db, { classId: cls.id, memberId: other.id, status });
    }

    const res = await book(cls.id, cookie);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'CLASS_FULL',
      message: 'This class is full. You can join the waiting list.',
    });
    expect(await bookingsOf(cls.id, member.id)).toHaveLength(0);
    expect(await activeCount(cls.id)).toBe(2);
  });

  it('AC 3: cancelled bookings do not hold a place', async () => {
    const { club, cookie } = await setup();
    const cls = await createClass(db, { clubId: club.id, startAt: at(DAY), capacity: 1 });
    const other = await createUser(db, { role: 'member', clubId: club.id });
    await createBooking(db, { classId: cls.id, memberId: other.id, status: 'cancelled' });

    expect((await book(cls.id, cookie)).statusCode).toBe(201);
  });

  it('AC 4: 20 parallel members for 1 free place give one 201 and nineteen CLASS_FULL', async () => {
    const { club } = await setup();
    const cls = await createClass(db, { clubId: club.id, startAt: at(DAY), capacity: 5 });
    for (let i = 0; i < 4; i += 1) {
      const other = await createUser(db, { role: 'member', clubId: club.id });
      await createBooking(db, { classId: cls.id, memberId: other.id, status: 'confirmed' });
    }
    const cookies: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      cookies.push(await signInAs(app, await createUser(db, { role: 'member', clubId: club.id })));
    }

    const results = await Promise.all(cookies.map((cookie) => book(cls.id, cookie)));

    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    const rejected = results.filter((r) => r.statusCode === 409);
    expect(rejected).toHaveLength(19);
    expect(rejected.every((r) => r.json().code === 'CLASS_FULL')).toBe(true);
    expect(await activeCount(cls.id)).toBe(5);
  });

  it('AC 5: a class that starts now, started earlier or is cancelled is not bookable', async () => {
    const { club, member, cookie } = await setup();
    const classes = [
      await createClass(db, { clubId: club.id, startAt: at(0), name: 'Now' }),
      await createClass(db, { clubId: club.id, startAt: at(-HOUR), name: 'Past' }),
      await createClass(db, { clubId: club.id, startAt: at(DAY), status: 'cancelled', name: 'Cancelled' }),
    ];

    for (const cls of classes) {
      const res = await book(cls.id, cookie);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        code: 'CLASS_NOT_BOOKABLE',
        message: 'This class can no longer be booked.',
      });
      expect(await bookingsOf(cls.id, member.id)).toHaveLength(0);
    }
  });

  it('AC 6: a member can book again after cancelling; the cancelled row is unchanged', async () => {
    const { club, member, cookie } = await setup();
    const cls = await createClass(db, { clubId: club.id, startAt: at(DAY), capacity: 5 });
    const cancelled = await createBooking(db, { classId: cls.id, memberId: member.id, status: 'cancelled' });
    const before = await db.selectFrom('booking').selectAll().where('id', '=', cancelled.id).executeTakeFirstOrThrow();

    const res = await book(cls.id, cookie);

    expect(res.statusCode).toBe(201);
    expect(res.json().id).not.toBe(cancelled.id);
    expect(await bookingsOf(cls.id, member.id)).toHaveLength(2);
    const after = await db.selectFrom('booking').selectAll().where('id', '=', cancelled.id).executeTakeFirstOrThrow();
    expect(after).toEqual(before);
    expect(await activeCount(cls.id)).toBe(1);
  });

  it('AC 7: a drop-in member gets a pending_payment booking, 202, and the place is held', async () => {
    const { club, member, cookie } = await setup('drop_in');
    const cls = await createClass(db, { clubId: club.id, startAt: at(DAY), capacity: 5 });

    const res = await book(cls.id, cookie);

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: 'pending_payment', memberId: member.id });
    expect((await bookingsOf(cls.id, member.id))[0].status).toBe('pending_payment');
    expect(await activeCount(cls.id)).toBe(1);
  });

  it('AC 8: instructors and club managers get 403 and nothing is stored', async () => {
    const { club } = await setup();
    const cls = await createClass(db, { clubId: club.id, startAt: at(DAY), capacity: 5 });

    for (const role of ['instructor', 'club_manager'] as const) {
      const staff = await createUser(db, { role, clubId: club.id });
      const res = await book(cls.id, await signInAs(app, staff));
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: 'FORBIDDEN', message: 'Only members can book classes.' });
    }
    expect(await activeCount(cls.id)).toBe(0);
  });

  it('AC 8: staff get 403 even for a malformed class id', async () => {
    const { club } = await setup();
    const staff = await createUser(db, { role: 'instructor', clubId: club.id });
    const res = await book('abc', await signInAs(app, staff));
    expect(res.statusCode).toBe(403);
  });

  it('AC 8: without a session the answer is 401 UNAUTHENTICATED', async () => {
    const { club } = await setup();
    const cls = await createClass(db, { clubId: club.id, startAt: at(DAY) });
    const res = await book(cls.id);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
  });

  it('AC 8: an unknown class is 404 CLASS_NOT_FOUND and a malformed id is 400 VALIDATION_ERROR', async () => {
    const { cookie } = await setup();

    const unknown = await book(randomUUID(), cookie);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ code: 'CLASS_NOT_FOUND', message: 'This class does not exist.' });

    const malformed = await book('abc', cookie);
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().code).toBe('VALIDATION_ERROR');
  });

  it('the member comes from the session, never from the request', async () => {
    const { club, member, cookie } = await setup();
    const victim = await createUser(db, { role: 'member', clubId: club.id });
    const cls = await createClass(db, { clubId: club.id, startAt: at(DAY), capacity: 5 });

    const res = await app.inject({
      method: 'POST',
      url: `/api/classes/${cls.id}/bookings`,
      headers: { cookie },
      payload: { memberId: victim.id },
    });

    expect(res.statusCode).toBe(201);
    expect(await bookingsOf(cls.id, member.id)).toHaveLength(1);
    expect(await bookingsOf(cls.id, victim.id)).toHaveLength(0);
  });

  it('DB: a second active row for the same member and class violates the unique index (23505)', async () => {
    const { club, member } = await setup();
    const cls = await createClass(db, { clubId: club.id, startAt: at(DAY), capacity: 5 });
    await createBooking(db, { classId: cls.id, memberId: member.id, status: 'confirmed' });

    await expect(
      db
        .insertInto('booking')
        .values({
          class_id: cls.id,
          member_id: member.id,
          status: 'pending_payment',
          source: 'direct',
          booked_at: T,
        })
        .execute(),
    ).rejects.toMatchObject({ code: '23505', constraint: 'booking_active_member_class_uq' });
  });
});
