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

describe('GET /api/classes (US-121)', () => {
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

  async function get(query: string, cookie?: string) {
    return app.inject({
      method: 'GET',
      url: `/api/classes${query}`,
      headers: cookie ? { cookie } : {},
    });
  }

  async function setup() {
    const club = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const member = await createUser(db, { role: 'member', clubId: club.id });
    const cookie = await signInAs(app, member);
    return { club, member, cookie };
  }

  it('AC 1: returns only classes in (now, now + 14 d]', async () => {
    const { club, cookie } = await setup();
    const offsets = [-DAY, -MIN, 0, 2 * HOUR, 10 * DAY, 14 * DAY, 20 * DAY];
    const created = [];
    for (const offset of offsets) {
      created.push(await createClass(db, { clubId: club.id, startAt: at(offset) }));
    }
    const res = await get('', cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((i: { id: string }) => i.id)).toEqual([created[3].id, created[4].id, created[5].id]);
  });

  it('AC 2: filters by club; without clubId returns all clubs', async () => {
    const { club, cookie } = await setup();
    const other = await createClub(db, { name: 'Club B', timezone: 'Europe/Stockholm' });
    const a = await createClass(db, { clubId: club.id, startAt: at(HOUR) });
    const b = await createClass(db, { clubId: other.id, startAt: at(2 * HOUR) });
    const filtered = await get(`?clubId=${club.id}`, cookie);
    expect(filtered.json().items.map((i: { id: string }) => i.id)).toEqual([a.id]);
    const all = await get('', cookie);
    expect(all.json().items.map((i: { id: string }) => i.id)).toEqual([a.id, b.id]);
  });

  it('AC 3: free places count confirmed and pending_payment only and never go below 0', async () => {
    const { club, cookie } = await setup();
    const cls = await createClass(db, { clubId: club.id, startAt: at(HOUR), capacity: 20 });
    const statuses = [
      ...Array<'confirmed'>(15).fill('confirmed'),
      ...Array<'pending_payment'>(3).fill('pending_payment'),
      ...Array<'cancelled'>(4).fill('cancelled'),
    ];
    for (const status of statuses) {
      const m = await createUser(db, { role: 'member', clubId: club.id });
      await createBooking(db, { classId: cls.id, memberId: m.id, status });
    }
    expect((await get('', cookie)).json().items[0].freePlaces).toBe(2);
    for (let i = 0; i < 2; i += 1) {
      const m = await createUser(db, { role: 'member', clubId: club.id });
      await createBooking(db, { classId: cls.id, memberId: m.id, status: 'confirmed' });
    }
    expect((await get('', cookie)).json().items[0].freePlaces).toBe(0);
  });

  it('AC 4: members see only their own booking status; staff always get none', async () => {
    const { club, cookie, member } = await setup();
    const confirmedClass = await createClass(db, { clubId: club.id, startAt: at(HOUR), name: 'A' });
    const pendingClass = await createClass(db, { clubId: club.id, startAt: at(2 * HOUR), name: 'B' });
    const cancelledOnly = await createClass(db, { clubId: club.id, startAt: at(3 * HOUR), name: 'C' });
    const othersClass = await createClass(db, { clubId: club.id, startAt: at(4 * HOUR), name: 'D' });
    const other = await createUser(db, { role: 'member', clubId: club.id });
    const own = await createBooking(db, { classId: confirmedClass.id, memberId: member.id, status: 'confirmed' });
    const pending = await createBooking(db, { classId: pendingClass.id, memberId: member.id, status: 'pending_payment' });
    await createBooking(db, { classId: cancelledOnly.id, memberId: member.id, status: 'cancelled' });
    await createBooking(db, { classId: othersClass.id, memberId: other.id, status: 'confirmed' });

    const res = await get('', cookie);
    const [a, b, c, d] = res.json().items;
    expect(a.myBookingStatus).toBe('confirmed');
    expect(a.myBooking).toEqual({ id: own.id, status: 'confirmed' });
    expect(b.myBookingStatus).toBe('pending_payment');
    expect(b.myBooking).toEqual({ id: pending.id, status: 'pending_payment' });
    for (const item of [c, d]) {
      expect(item.myBookingStatus).toBe('none');
      expect(item.myBooking).toBeNull();
    }
    expect(res.json().items.every((i: { myWaitlist: unknown }) => i.myWaitlist === null)).toBe(true);

    for (const role of ['instructor', 'club_manager'] as const) {
      const staff = await createUser(db, { role, clubId: club.id });
      const staffRes = await get('', await signInAs(app, staff));
      for (const item of staffRes.json().items) {
        expect(item.myBookingStatus).toBe('none');
        expect(item.myBooking).toBeNull();
        expect(item.myWaitlist).toBeNull();
      }
    }
  });

  it('AC 5: unknown club → 404 CLUB_NOT_FOUND; malformed clubId → 400 on clubId', async () => {
    const { cookie } = await setup();
    const missing = await get(`?clubId=${randomUUID()}`, cookie);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'CLUB_NOT_FOUND', message: 'Club not found.' });

    const invalid = await get('?clubId=abc', cookie);
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe('VALIDATION_ERROR');
    expect(invalid.json().fieldErrors).toContainEqual({ field: 'clubId', message: 'Choose a valid club.' });
  });

  it('AC 6: no classes → 200 with empty items', async () => {
    const { club, cookie } = await setup();
    const res = await get(`?clubId=${club.id}`, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });

  it('AC 7: cancelled classes stay in the list with status cancelled', async () => {
    const { club, cookie } = await setup();
    await createClass(db, { clubId: club.id, startAt: at(HOUR), status: 'cancelled' });
    const res = await get('', cookie);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].status).toBe('cancelled');
  });

  it('AC 8: sorted by startAt, then name, then id; carries the club time zone', async () => {
    const { club, cookie } = await setup();
    const later = await createClass(db, { clubId: club.id, startAt: at(3 * HOUR), name: 'Aerobics' });
    const sameB = await createClass(db, { clubId: club.id, startAt: at(HOUR), name: 'Yoga' });
    const sameA = await createClass(db, { clubId: club.id, startAt: at(HOUR), name: 'Spinning' });
    const res = await get('', cookie);
    expect(res.json().items.map((i: { id: string }) => i.id)).toEqual([sameA.id, sameB.id, later.id]);
    expect(res.json().items[0].clubTimezone).toBe('Europe/Stockholm');
  });

  it('AC 9: narrows, clamps and echoes the effective period', async () => {
    const { club, cookie } = await setup();
    const inside = await createClass(db, { clubId: club.id, startAt: at(2 * DAY) });
    await createClass(db, { clubId: club.id, startAt: at(8 * DAY) });
    const narrowed = await get(
      `?from=${encodeURIComponent(at(DAY).toISOString())}&to=${encodeURIComponent(at(3 * DAY).toISOString())}`,
      cookie,
    );
    expect(narrowed.json().items.map((i: { id: string }) => i.id)).toEqual([inside.id]);

    const clamped = await get(`?to=${encodeURIComponent(at(30 * DAY).toISOString())}`, cookie);
    expect(clamped.json().to).toBe(at(14 * DAY).toISOString());
    expect(clamped.json().from).toBe(T.toISOString());

    const past = await get(
      `?from=${encodeURIComponent(at(-5 * DAY).toISOString())}&to=${encodeURIComponent(at(-DAY).toISOString())}`,
      cookie,
    );
    expect(past.statusCode).toBe(200);
    expect(past.json().items).toEqual([]);

    const badFrom = await get('?from=xyz', cookie);
    expect(badFrom.statusCode).toBe(400);
    expect(badFrom.json().fieldErrors).toContainEqual({ field: 'from', message: 'Enter a valid date and time.' });

    const sameInstant = encodeURIComponent(at(DAY).toISOString());
    const reversed = await get(`?from=${sameInstant}&to=${sameInstant}`, cookie);
    expect(reversed.statusCode).toBe(400);
    expect(reversed.json().fieldErrors).toContainEqual({
      field: 'to',
      message: 'The end of the period must be after its start.',
    });
  });

  it('AC 10: no session → 401, also for an invalid query', async () => {
    const expected = { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' };
    const anonymous = await get('');
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual(expected);
    const invalid = await get('?clubId=abc');
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toEqual(expected);
  });

  it('AC 10: no-store header and no member or instructor ids in the response', async () => {
    const { club, cookie, member } = await setup();
    const instructor = await createUser(db, { role: 'instructor', clubId: club.id });
    const cls = await createClass(db, { clubId: club.id, startAt: at(HOUR), instructorId: instructor.id });
    await createBooking(db, { classId: cls.id, memberId: member.id, status: 'confirmed' });
    const res = await get('', cookie);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body;
    expect(body).not.toContain('instructorId');
    expect(body).not.toContain('createdBy');
    expect(body).not.toContain('memberId');
    expect(body).not.toContain(instructor.id);
    expect(body).not.toContain(member.id);
  });

  it('US-126: canCancel is true only for staff who may cancel an upcoming scheduled class', async () => {
    const { club, cookie: memberCookie } = await setup();
    const otherClub = await createClub(db, { name: 'Club B', timezone: 'Europe/Stockholm' });
    const lead = await createUser(db, { role: 'instructor', clubId: club.id });
    const colleague = await createUser(db, { role: 'instructor', clubId: club.id });
    const manager = await createUser(db, { role: 'club_manager', clubId: club.id });
    const foreignManager = await createUser(db, { role: 'club_manager', clubId: otherClub.id });
    const led = await createClass(db, { clubId: club.id, startAt: at(HOUR), name: 'Led', instructorId: lead.id });
    const cancelled = await createClass(db, {
      clubId: club.id,
      startAt: at(2 * HOUR),
      name: 'Cancelled',
      instructorId: lead.id,
      status: 'cancelled',
    });

    const canCancelBy = async (user: { id: string; role: 'instructor' | 'club_manager' | 'member'; clubId: string }) => {
      const res = await get('', await signInAs(app, user));
      const byId = new Map<string, boolean>(
        res.json().items.map((i: { id: string; canCancel: boolean }) => [i.id, i.canCancel]),
      );
      return { led: byId.get(led.id), cancelled: byId.get(cancelled.id) };
    };

    expect(await canCancelBy(manager)).toEqual({ led: true, cancelled: false });
    expect(await canCancelBy(lead)).toEqual({ led: true, cancelled: false });
    expect((await canCancelBy(colleague)).led).toBe(false);
    expect((await canCancelBy(foreignManager)).led).toBe(false);

    const memberRes = await get('', memberCookie);
    expect(memberRes.json().items.every((i: { canCancel: boolean }) => i.canCancel === false)).toBe(true);
    expect(memberRes.body).not.toContain('instructorId');
    expect(memberRes.body).not.toContain(lead.id);
  });
});
