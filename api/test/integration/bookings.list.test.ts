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

type App = Awaited<ReturnType<typeof buildApp>>;
type Item = { id: string; className: string; clubName: string; startAt: string; status: string; canCancel: boolean };
type Status = 'confirmed' | 'pending_payment' | 'cancelled';

describe('booking lists and staff scope (US-123)', () => {
  let app: App;
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
  });

  async function get(url: string, cookie?: string) {
    return app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
  }

  async function setup() {
    const clubA = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const clubB = await createClub(db, { name: 'Club B', timezone: 'Europe/Stockholm' });
    const member = await createUser(db, { role: 'member', clubId: clubA.id });
    const other = await createUser(db, { role: 'member', clubId: clubA.id, fullName: 'Other Member' });
    return { clubA, clubB, member, other, cookie: await signInAs(app, member) };
  }

  /** The member's bookings from the story: 3 upcoming active (one already running), 1 cancelled upcoming, 1 ended. */
  async function seedMemberBookings() {
    const ctx = await setup();
    const make = async (name: string, offset: number, memberId = ctx.member.id, status: Status = 'confirmed') => {
      const cls = await createClass(db, { clubId: ctx.clubA.id, startAt: at(offset), name, durationMinutes: 45 });
      return createBooking(db, { classId: cls.id, memberId, status });
    };
    const later = await make('Later', 3 * DAY, ctx.member.id, 'pending_payment');
    const running = await make('Running', -10 * MIN);
    const soon = await make('Soon', 2 * HOUR);
    await make('Cancelled', HOUR, ctx.member.id, 'cancelled');
    const ended = await make('Ended', -3 * HOUR);
    const endedCancelled = await make('Ended cancelled', -DAY, ctx.member.id, 'cancelled');
    await make('Foreign', HOUR, ctx.other.id);
    return { ...ctx, later, running, soon, ended, endedCancelled };
  }

  it('AC 1: lists only the own active bookings on classes that have not ended, soonest first', async () => {
    const s = await seedMemberBookings();
    const res = await get('/api/me/bookings', s.cookie);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Item[]; total: number };
    expect(body.items.map((i) => i.id)).toEqual([s.running.id, s.soon.id, s.later.id]);
    expect(body.total).toBe(3);
    expect(body.items[1]).toMatchObject({
      className: 'Soon',
      clubName: 'Club A',
      startAt: at(2 * HOUR).toISOString(),
      status: 'confirmed',
      canCancel: true,
    });
    // The class has started: it is still listed, but it can no longer be cancelled.
    expect(body.items[0].canCancel).toBe(false);
  });

  it('AC 1: limit and offset page through the list and total stays the full count', async () => {
    const s = await seedMemberBookings();
    const res = await get('/api/me/bookings?limit=1&offset=1', s.cookie);
    const body = res.json() as { items: Item[]; total: number };
    expect(body.items.map((i) => i.id)).toEqual([s.soon.id]);
    expect(body.total).toBe(3);
    expect((await get('/api/me/bookings?limit=101', s.cookie)).statusCode).toBe(400);
  });

  it('AC 2: period=past lists ended classes of any status, most recent first', async () => {
    const s = await seedMemberBookings();
    const res = await get('/api/me/bookings?period=past', s.cookie);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Item[]; total: number };
    expect(body.items.map((i) => i.id)).toEqual([s.ended.id, s.endedCancelled.id]);
    expect(body.items[1].status).toBe('cancelled');
    expect(body.items.every((i) => !i.canCancel)).toBe(true);
  });

  it('AC 2: an invalid period is a 400 VALIDATION_ERROR', async () => {
    const { cookie } = await setup();
    const res = await get('/api/me/bookings?period=foo', cookie);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('AC 2: an empty list is a 200 with no items', async () => {
    const { cookie } = await setup();
    expect((await get('/api/me/bookings', cookie)).json()).toEqual({ items: [], total: 0 });
    expect((await get('/api/me/bookings?period=past', cookie)).json()).toEqual({ items: [], total: 0 });
  });

  it('AC 5: staff cannot use the member list; signed-out callers get 401', async () => {
    const { clubA } = await setup();
    const staff = await createUser(db, { role: 'instructor', clubId: clubA.id });
    const res = await get('/api/me/bookings', await signInAs(app, staff));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: 'FORBIDDEN', message: 'Only members can view their bookings.' });
    expect((await get('/api/me/bookings')).statusCode).toBe(401);
  });

  it('AC 5: staff read the roster of a class in their own club, names only', async () => {
    const { clubA, member } = await setup();
    const zed = await createUser(db, { role: 'member', clubId: clubA.id, fullName: 'Zed Last', email: 'zed@example.com' });
    const ann = await createUser(db, { role: 'member', clubId: clubA.id, fullName: 'Ann First' });
    const cls = await createClass(db, { clubId: clubA.id, startAt: at(DAY), capacity: 10 });
    await createBooking(db, { classId: cls.id, memberId: zed.id, status: 'confirmed' });
    await createBooking(db, { classId: cls.id, memberId: ann.id, status: 'pending_payment' });
    await createBooking(db, { classId: cls.id, memberId: member.id, status: 'cancelled' });
    for (const role of ['club_manager', 'instructor'] as const) {
      const staff = await createUser(db, { role, clubId: clubA.id });
      const res = await get(`/api/classes/${cls.id}/bookings`, await signInAs(app, staff));
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: { memberName: string }[] };
      expect(body).toMatchObject({ classId: cls.id, capacity: 10, freePlaces: 8 });
      expect(body.items.map((i) => i.memberName)).toEqual(['Ann First', 'Zed Last']);
      expect(res.body).not.toContain('zed@example.com');
    }
  });

  it('AC 5: staff of another club get 403; a member gets 403; an unknown class is 404', async () => {
    const { clubA, clubB, cookie } = await setup();
    const cls = await createClass(db, { clubId: clubB.id, startAt: at(DAY) });
    const staffCookie = await signInAs(app, await createUser(db, { role: 'club_manager', clubId: clubA.id }));

    const foreign = await get(`/api/classes/${cls.id}/bookings`, staffCookie);
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toEqual({ code: 'FORBIDDEN', message: 'You can only manage classes for your own club.' });

    const asMember = await get(`/api/classes/${cls.id}/bookings`, cookie);
    expect(asMember.statusCode).toBe(403);
    expect(asMember.json().message).toBe('Only instructors and club managers can manage classes.');

    const unknown = await get('/api/classes/00000000-0000-4000-8000-000000000000/bookings', staffCookie);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ code: 'CLASS_NOT_FOUND', message: 'This class does not exist.' });
  });

  it('AC 5: staff read a booking of their club (with the member name, canCancel false) but not of another club', async () => {
    const { clubA, clubB, member } = await setup();
    const classA = await createClass(db, { clubId: clubA.id, startAt: at(DAY) });
    const classB = await createClass(db, { clubId: clubB.id, startAt: at(DAY) });
    const inA = await createBooking(db, { classId: classA.id, memberId: member.id, status: 'confirmed' });
    const inB = await createBooking(db, { classId: classB.id, memberId: member.id, status: 'confirmed' });
    const staffCookie = await signInAs(app, await createUser(db, { role: 'instructor', clubId: clubA.id }));

    const own = await get(`/api/bookings/${inA.id}`, staffCookie);
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ id: inA.id, memberName: 'Test User', canCancel: false });

    const foreign = await get(`/api/bookings/${inB.id}`, staffCookie);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().code).toBe('BOOKING_NOT_FOUND');
  });

  it('AC 5: a member reads their own booking without memberName', async () => {
    const { clubA, member, cookie } = await setup();
    const cls = await createClass(db, { clubId: clubA.id, startAt: at(DAY) });
    const booking = await createBooking(db, { classId: cls.id, memberId: member.id, status: 'confirmed' });
    const res = await get(`/api/bookings/${booking.id}`, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: booking.id, canCancel: true });
    expect(res.json()).not.toHaveProperty('memberName');
  });
});
