import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { DomainEventBus, type AttendanceRecorded } from '../../src/shared/domain-events.js';
import { signInAs } from '../helpers/auth.js';
import { testDb } from '../helpers/db.js';
import { createBooking, createClass, createClub, createUser } from '../helpers/factories.js';

const START = new Date('2026-10-30T09:00:00.000Z');
const DURATION = 60;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const CLOSES_AT = START.getTime() + DURATION * MIN + 24 * HOUR;
const at = (offsetMs: number): Date => new Date(START.getTime() + offsetMs);

type App = Awaited<ReturnType<typeof buildApp>>;
type Attendance = 'attended' | 'no_show';

describe('PUT/GET /api/classes/:classId/attendance (US-129)', () => {
  const db = testDb();
  const events: AttendanceRecorded[] = [];
  let app: App;
  let now = START;

  beforeAll(async () => {
    const bus = new DomainEventBus();
    bus.subscribe('AttendanceRecorded', async (_trx, event) => {
      events.push(event);
    });
    app = await buildApp({ clock: { now: () => now }, events: bus });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    events.length = 0;
    now = at(10 * MIN);
    await db.deleteFrom('booking').execute();
    await db.deleteFrom('gym_class').execute();
  });

  /** Signs in at the app's current time, so the session is valid whatever `now` the test sets. */
  const cookieFor = (user: { id: string }) => signInAs(app, user, { now: () => now });

  async function setup(confirmed = 0) {
    const club = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const instructor = await createUser(db, { role: 'instructor', clubId: club.id });
    const manager = await createUser(db, { role: 'club_manager', clubId: club.id });
    const gymClass = await createClass(db, { clubId: club.id, startAt: START, durationMinutes: DURATION });
    const bookings = [];
    for (let i = 0; i < confirmed; i++) {
      const member = await createUser(db, {
        role: 'member',
        clubId: club.id,
        fullName: `Member ${String(i).padStart(2, '0')}`,
      });
      bookings.push(await createBooking(db, { classId: gymClass.id, memberId: member.id, status: 'confirmed' }));
    }
    return { club, instructor, manager, gymClass, bookings };
  }

  const put = (classId: string, entries: { bookingId: string; attendance: string }[], cookie?: string) =>
    app.inject({
      method: 'PUT',
      url: `/api/classes/${classId}/attendance`,
      headers: cookie ? { cookie } : {},
      payload: { entries },
    });
  const get = (classId: string, cookie?: string) =>
    app.inject({ method: 'GET', url: `/api/classes/${classId}/attendance`, headers: cookie ? { cookie } : {} });
  const rowsOf = (classId: string) =>
    db.selectFrom('booking').selectAll().where('class_id', '=', classId).orderBy('id').execute();

  it('AC 1: saves 15 attended and 3 no_show with audit columns and one event per booking', async () => {
    const { instructor, gymClass, bookings } = await setup(18);
    const entries = bookings.map((booking, i) => ({
      bookingId: booking.id,
      attendance: (i < 15 ? 'attended' : 'no_show') as Attendance,
    }));

    const res = await put(gymClass.id, entries, await cookieFor(instructor));

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary).toEqual({ booked: 18, attended: 15, noShows: 3, unknown: 0 });
    expect(body.window.state).toBe('open');
    expect(body.canEdit).toBe(true);
    expect(body.items).toHaveLength(18);
    expect(body.items.map((item: { memberName: string }) => item.memberName)).toEqual(
      bookings.map((_, i) => `Member ${String(i).padStart(2, '0')}`),
    );
    expect(JSON.stringify(body)).not.toContain('@');

    const expected = new Map(entries.map((entry) => [entry.bookingId, entry.attendance]));
    const rows = await rowsOf(gymClass.id);
    expect(rows).toHaveLength(18);
    for (const row of rows) {
      expect(row.attendance).toBe(expected.get(row.id));
      expect(row.attendance_recorded_by).toBe(instructor.id);
      expect(row.attendance_recorded_at?.getTime()).toBe(now.getTime());
    }
    expect(events).toHaveLength(18);
    expect(events.every((event) => event.previousAttendance === 'unknown' && event.recordedBy === instructor.id)).toBe(
      true,
    );
    expect(events.every((event) => event.classStartAt.getTime() === START.getTime())).toBe(true);
  });

  it('AC 2: refuses a save before the class start and changes nothing', async () => {
    const { instructor, gymClass, bookings } = await setup(2);
    now = at(-MIN);
    const res = await put(
      gymClass.id,
      [{ bookingId: bookings[0].id, attendance: 'attended' }],
      await cookieFor(instructor),
    );
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      code: 'ATTENDANCE_NOT_OPEN',
      message: 'Attendance can be recorded once the class has started.',
    });
    expect((await rowsOf(gymClass.id)).every((row) => row.attendance === 'unknown')).toBe(true);
    expect(events).toHaveLength(0);
  });

  it('AC 2: GET works before the start so staff can view the list', async () => {
    const { instructor, gymClass } = await setup(1);
    now = at(-HOUR);
    const res = await get(gymClass.id, await cookieFor(instructor));
    expect(res.statusCode).toBe(200);
    expect(res.json().window.state).toBe('not_open');
    expect(res.json().canEdit).toBe(false);
  });

  it('AC 3: a member gets 403, staff of another club get 403, anonymous gets 401; nothing changes', async () => {
    const { club, gymClass, bookings } = await setup(1);
    const member = await createUser(db, { role: 'member', clubId: club.id });
    const otherClub = await createClub(db, { name: 'Club B', timezone: 'Europe/Stockholm' });
    const otherInstructor = await createUser(db, { role: 'instructor', clubId: otherClub.id });
    const otherManager = await createUser(db, { role: 'club_manager', clubId: otherClub.id });
    const entries = [{ bookingId: bookings[0].id, attendance: 'attended' }];

    const asMember = await put(gymClass.id, entries, await cookieFor(member));
    expect(asMember.statusCode).toBe(403);
    expect(asMember.json()).toEqual({
      code: 'FORBIDDEN',
      message: 'Only instructors and club managers can manage classes.',
    });

    for (const staff of [otherInstructor, otherManager]) {
      const res = await put(gymClass.id, entries, await cookieFor(staff));
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({
        code: 'FORBIDDEN',
        message: 'You can only manage classes for your own club.',
      });
    }

    expect((await put(gymClass.id, entries)).statusCode).toBe(401);
    expect((await rowsOf(gymClass.id))[0].attendance).toBe('unknown');
    expect(events).toHaveLength(0);
  });

  it('AC 4: the roster lists only confirmed bookings', async () => {
    const { club, instructor, gymClass } = await setup(2);
    for (const status of ['cancelled', 'pending_payment'] as const) {
      const member = await createUser(db, { role: 'member', clubId: club.id });
      await createBooking(db, { classId: gymClass.id, memberId: member.id, status });
    }
    const res = await get(gymClass.id, await cookieFor(instructor));
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(2);
    expect(res.json().summary).toEqual({ booked: 2, attended: 0, noShows: 0, unknown: 2 });
  });

  it('AC 4: a cancelled, pending or foreign booking rejects the whole request (all-or-nothing)', async () => {
    const { club, instructor, gymClass, bookings } = await setup(1);
    const cancelledMember = await createUser(db, { role: 'member', clubId: club.id });
    const cancelled = await createBooking(db, {
      classId: gymClass.id,
      memberId: cancelledMember.id,
      status: 'cancelled',
    });
    const pendingMember = await createUser(db, { role: 'member', clubId: club.id });
    const pending = await createBooking(db, {
      classId: gymClass.id,
      memberId: pendingMember.id,
      status: 'pending_payment',
    });
    const otherClass = await createClass(db, { clubId: club.id, startAt: START });
    const foreign = await createBooking(db, {
      classId: otherClass.id,
      memberId: cancelledMember.id,
      status: 'confirmed',
    });

    const res = await put(
      gymClass.id,
      [
        { bookingId: bookings[0].id, attendance: 'attended' },
        { bookingId: cancelled.id, attendance: 'attended' },
        { bookingId: pending.id, attendance: 'no_show' },
        { bookingId: foreign.id, attendance: 'attended' },
        { bookingId: randomUUID(), attendance: 'attended' },
      ],
      await cookieFor(instructor),
    );

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.fieldErrors.map((error: { field: string }) => error.field)).toEqual([
      'entries[1].bookingId',
      'entries[2].bookingId',
      'entries[3].bookingId',
      'entries[4].bookingId',
    ]);
    expect(body.fieldErrors[0].message).toBe('This booking is not on the attendance list for this class.');
    expect((await rowsOf(gymClass.id)).every((row) => row.attendance === 'unknown')).toBe(true);
    expect((await rowsOf(otherClass.id))[0].attendance).toBe('unknown');
    expect(events).toHaveLength(0);
  });

  it.each([
    ['an empty entry list', { entries: [] }],
    ['an unknown attendance value', { entries: [{ bookingId: randomUUID(), attendance: 'unknown' }] }],
    ['a booking id that is not a UUID', { entries: [{ bookingId: 'nope', attendance: 'attended' }] }],
    ['an unexpected property', { entries: [{ bookingId: randomUUID(), attendance: 'attended' }], extra: 1 }],
  ])('AC 4: %s → 400 VALIDATION_ERROR', async (_name, payload) => {
    const { instructor, gymClass } = await setup(0);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/classes/${gymClass.id}/attendance`,
      headers: { cookie: await cookieFor(instructor) },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('AC 4: the same booking twice in one request → 400, nothing changes', async () => {
    const { instructor, gymClass, bookings } = await setup(1);
    const res = await put(
      gymClass.id,
      [
        { bookingId: bookings[0].id, attendance: 'attended' },
        { bookingId: bookings[0].id, attendance: 'no_show' },
      ],
      await cookieFor(instructor),
    );
    expect(res.statusCode).toBe(400);
    expect((await rowsOf(gymClass.id))[0].attendance).toBe('unknown');
  });

  it('AC 4: more than 200 entries → 400', async () => {
    const { instructor, gymClass } = await setup(0);
    const entries = Array.from({ length: 201 }, () => ({ bookingId: randomUUID(), attendance: 'attended' }));
    const res = await put(gymClass.id, entries, await cookieFor(instructor));
    expect(res.statusCode).toBe(400);
  });

  it('AC 5: the instructor is refused from exactly class end + 24 h, and accepted one millisecond before', async () => {
    const { instructor, gymClass, bookings } = await setup(1);
    const entries = [{ bookingId: bookings[0].id, attendance: 'attended' }];

    now = at(CLOSES_AT - START.getTime());
    const closed = await put(gymClass.id, entries, await cookieFor(instructor));
    expect(closed.statusCode).toBe(409);
    expect(closed.json()).toEqual({
      code: 'ATTENDANCE_CLOSED',
      message: 'Attendance for this class can no longer be changed. Ask your club manager to correct it.',
    });
    expect((await rowsOf(gymClass.id))[0].attendance).toBe('unknown');

    now = at(CLOSES_AT - START.getTime() - 1);
    const open = await put(gymClass.id, entries, await cookieFor(instructor));
    expect(open.statusCode).toBe(200);
  });

  it('AC 5: the club manager corrects no_show to attended after the window', async () => {
    const { instructor, manager, gymClass, bookings } = await setup(1);
    const entries = (attendance: Attendance) => [{ bookingId: bookings[0].id, attendance }];
    expect((await put(gymClass.id, entries('no_show'), await cookieFor(instructor))).statusCode).toBe(200);
    events.length = 0;

    now = at(CLOSES_AT - START.getTime() + HOUR);
    const res = await put(gymClass.id, entries('attended'), await cookieFor(manager));

    expect(res.statusCode).toBe(200);
    expect(res.json().canEdit).toBe(true);
    expect(res.json().window.state).toBe('closed');
    const [row] = await rowsOf(gymClass.id);
    expect(row.attendance).toBe('attended');
    expect(row.attendance_recorded_by).toBe(manager.id);
    expect(row.attendance_recorded_at?.getTime()).toBe(now.getTime());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      bookingId: bookings[0].id,
      previousAttendance: 'no_show',
      attendance: 'attended',
      recordedBy: manager.id,
    });
  });

  it('AC 5: the instructor sees the closed roster read-only (canEdit false)', async () => {
    const { instructor, gymClass } = await setup(1);
    now = at(CLOSES_AT - START.getTime() + HOUR);
    const res = await get(gymClass.id, await cookieFor(instructor));
    expect(res.statusCode).toBe(200);
    expect(res.json().canEdit).toBe(false);
    expect(res.json().window.state).toBe('closed');
  });

  it('AC 6: saving the same values again changes nothing and publishes nothing', async () => {
    const { instructor, gymClass, bookings } = await setup(3);
    const entries = bookings.map((booking) => ({ bookingId: booking.id, attendance: 'attended' as Attendance }));
    const cookie = await cookieFor(instructor);
    expect((await put(gymClass.id, entries, cookie)).statusCode).toBe(200);
    const before = await rowsOf(gymClass.id);
    events.length = 0;

    now = at(30 * MIN);
    const res = await put(gymClass.id, entries, await cookieFor(instructor));

    expect(res.statusCode).toBe(200);
    const after = await rowsOf(gymClass.id);
    expect(after.map((row) => row.attendance_recorded_at?.getTime())).toEqual(
      before.map((row) => row.attendance_recorded_at?.getTime()),
    );
    expect(events).toHaveLength(0);
  });

  it('AC 6: a partial change only touches the changed booking', async () => {
    const { instructor, gymClass, bookings } = await setup(2);
    const cookie = await cookieFor(instructor);
    await put(
      gymClass.id,
      bookings.map((booking) => ({ bookingId: booking.id, attendance: 'attended' as Attendance })),
      cookie,
    );
    events.length = 0;
    now = at(20 * MIN);
    await put(
      gymClass.id,
      [
        { bookingId: bookings[0].id, attendance: 'attended' },
        { bookingId: bookings[1].id, attendance: 'no_show' },
      ],
      await cookieFor(instructor),
    );
    expect(events.map((event) => event.bookingId)).toEqual([bookings[1].id]);
  });

  it('AC 7: a cancelled class → 409 CLASS_CANCELLED for save and view', async () => {
    const { club, instructor } = await setup(0);
    const cancelled = await createClass(db, { clubId: club.id, startAt: START, status: 'cancelled' });
    const cookie = await cookieFor(instructor);
    const saved = await put(cancelled.id, [{ bookingId: randomUUID(), attendance: 'attended' }], cookie);
    expect(saved.statusCode).toBe(409);
    expect(saved.json()).toEqual({ code: 'CLASS_CANCELLED', message: 'This class has been cancelled.' });
    expect((await get(cancelled.id, cookie)).statusCode).toBe(409);
  });

  it('AC 7: an unknown class → 404 CLASS_NOT_FOUND', async () => {
    const { instructor } = await setup(0);
    const cookie = await cookieFor(instructor);
    const saved = await put(randomUUID(), [{ bookingId: randomUUID(), attendance: 'attended' }], cookie);
    expect(saved.statusCode).toBe(404);
    expect(saved.json()).toEqual({ code: 'CLASS_NOT_FOUND', message: 'This class does not exist.' });
    expect((await get(randomUUID(), cookie)).statusCode).toBe(404);
  });

  it('a handler that fails rolls the whole save back (ADR-009)', async () => {
    const failing = new DomainEventBus();
    failing.subscribe('AttendanceRecorded', async () => {
      throw new Error('block rule failed');
    });
    const failingApp = await buildApp({ clock: { now: () => now }, events: failing });
    try {
      const { instructor, gymClass, bookings } = await setup(1);
      const cookie = await signInAs(failingApp, instructor, { now: () => now });
      const res = await failingApp.inject({
        method: 'PUT',
        url: `/api/classes/${gymClass.id}/attendance`,
        headers: { cookie },
        payload: { entries: [{ bookingId: bookings[0].id, attendance: 'no_show' }] },
      });
      expect(res.statusCode).toBe(500);
      const [row] = await rowsOf(gymClass.id);
      expect(row.attendance).toBe('unknown');
      expect(row.attendance_recorded_at).toBeNull();
    } finally {
      await failingApp.close();
    }
  });

  it('DB: attendance other than unknown without a timestamp violates booking_attendance_recorded_ck', async () => {
    const { gymClass, bookings } = await setup(1);
    await expect(
      db.updateTable('booking').set({ attendance: 'attended' }).where('id', '=', bookings[0].id).execute(),
    ).rejects.toThrow(/booking_attendance_recorded_ck/);
    await expect(
      db
        .updateTable('booking')
        .set({ attendance: 'unknown', attendance_recorded_at: now })
        .where('class_id', '=', gymClass.id)
        .execute(),
    ).rejects.toThrow(/booking_attendance_recorded_ck/);
  });
});
