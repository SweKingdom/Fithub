import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { countActiveBookings } from '../../src/modules/bookings/repository.js';
import { DomainEventBus, type BookingCancelled } from '../../src/shared/domain-events.js';
import { signInAs } from '../helpers/auth.js';
import { testDb } from '../helpers/db.js';
import { createBooking, createClass, createClub, createUser } from '../helpers/factories.js';

const T = new Date('2026-10-30T09:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

type App = Awaited<ReturnType<typeof buildApp>>;

describe('cancel my booking (US-124)', () => {
  const db = testDb();
  const apps: App[] = [];
  const spy = vi.fn<(event: BookingCancelled) => void>();

  /** An app with a fixed clock, a spy subscriber on `BookingCancelled` and optionally another cut-off or subscriber. */
  async function createApp(options: { cutoff?: number; failingSubscriber?: boolean } = {}): Promise<App> {
    const events = new DomainEventBus();
    events.subscribe('BookingCancelled', async (_trx, event) => {
      spy(event);
      if (options.failingSubscriber) throw new Error('subscriber failed');
    });
    const config = { ...loadConfig({}), bookingCancelCutoffMinutes: options.cutoff ?? 120 };
    const app = await buildApp({ clock: { now: () => T }, events, config });
    apps.push(app);
    return app;
  }

  beforeEach(async () => {
    spy.mockClear();
    await db.deleteFrom('waitlist_entry').execute();
    await db.deleteFrom('booking').execute();
    await db.deleteFrom('gym_class').execute();
  });
  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  /** A member with a booking on a class that starts `startsInMs` after the fixed clock. */
  async function setup(
    app: App,
    startsInMs: number,
    fields: { status?: 'confirmed' | 'pending_payment' | 'cancelled'; classStatus?: 'scheduled' | 'cancelled' } = {},
  ) {
    const club = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const member = await createUser(db, { role: 'member', clubId: club.id });
    const cls = await createClass(db, {
      clubId: club.id,
      startAt: new Date(T.getTime() + startsInMs),
      capacity: 5,
      status: fields.classStatus,
    });
    const booking = await createBooking(db, {
      classId: cls.id,
      memberId: member.id,
      status: fields.status ?? 'confirmed',
    });
    return { club, member, cls, booking, cookie: await signInAs(app, member) };
  }

  const cancel = (app: App, bookingId: string, cookie: string) =>
    app.inject({ method: 'POST', url: `/api/bookings/${bookingId}/cancel`, headers: { cookie } });

  const row = (id: string) => db.selectFrom('booking').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  it('AC 1: cancels in time, returns the cancelled booking and frees the place', async () => {
    const app = await createApp();
    const s = await setup(app, 3 * HOUR);
    expect(await countActiveBookings(db, s.cls.id)).toBe(1);

    const res = await cancel(app, s.booking.id, s.cookie);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: s.booking.id,
      status: 'cancelled',
      cancelledAt: T.toISOString(),
      canCancel: false,
    });
    expect(await row(s.booking.id)).toMatchObject({ status: 'cancelled', cancelled_at: T });
    expect(await countActiveBookings(db, s.cls.id)).toBe(0);
  });

  it('AC 1: a pending_payment booking can be cancelled and the event carries that previous status', async () => {
    const app = await createApp();
    const s = await setup(app, 3 * HOUR, { status: 'pending_payment' });

    const res = await cancel(app, s.booking.id, s.cookie);

    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].previousStatus).toBe('pending_payment');
  });

  it('AC 2: a class starting in exactly 120 minutes can be cancelled', async () => {
    const app = await createApp();
    const s = await setup(app, 120 * MINUTE);
    expect((await cancel(app, s.booking.id, s.cookie)).statusCode).toBe(200);
  });

  it('AC 2: a class starting in 119 minutes 59 seconds is rejected', async () => {
    const app = await createApp();
    const s = await setup(app, 120 * MINUTE - SECOND);
    const res = await cancel(app, s.booking.id, s.cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CANCELLATION_WINDOW_CLOSED');
    expect((await row(s.booking.id)).status).toBe('confirmed');
  });

  it('AC 3: too late gives 409 with the message, leaves the row alone and raises no event', async () => {
    const app = await createApp();
    const s = await setup(app, HOUR);
    const before = JSON.stringify(await row(s.booking.id));

    const res = await cancel(app, s.booking.id, s.cookie);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      code: 'CANCELLATION_WINDOW_CLOSED',
      message: 'Bookings can only be cancelled up to 2 hours before the class starts.',
    });
    expect(JSON.stringify(await row(s.booking.id))).toBe(before);
    expect(spy).not.toHaveBeenCalled();
  });

  it('AC 4: an already cancelled booking gives 409, keeps cancelled_at and raises no event', async () => {
    const app = await createApp();
    const s = await setup(app, 3 * HOUR, { status: 'cancelled' });
    const earlier = new Date(T.getTime() - HOUR);
    await db.updateTable('booking').set({ cancelled_at: earlier }).where('id', '=', s.booking.id).execute();

    const res = await cancel(app, s.booking.id, s.cookie);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'BOOKING_ALREADY_CANCELLED', message: 'This booking is already cancelled.' });
    expect((await row(s.booking.id)).cancelled_at).toEqual(earlier);
    expect(spy).not.toHaveBeenCalled();
  });

  it('AC 5: another member’s booking and an unknown id are 404 and the row is unchanged', async () => {
    const app = await createApp();
    const s = await setup(app, 3 * HOUR);
    const other = await createUser(db, { role: 'member', clubId: s.club.id });
    const otherCookie = await signInAs(app, other);

    const foreign = await cancel(app, s.booking.id, otherCookie);
    const unknown = await cancel(app, '00000000-0000-4000-8000-000000000000', otherCookie);

    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().code).toBe('BOOKING_NOT_FOUND');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe('BOOKING_NOT_FOUND');
    expect(await row(s.booking.id)).toMatchObject({ status: 'confirmed', cancelled_at: null });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(['instructor', 'club_manager'] as const)('AC 5: a %s gets 403 and nothing changes', async (role) => {
    const app = await createApp();
    const s = await setup(app, 3 * HOUR);
    const staff = await createUser(db, { role, clubId: s.club.id });

    const res = await cancel(app, s.booking.id, await signInAs(app, staff));

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: 'FORBIDDEN', message: 'Only members can cancel their own bookings.' });
    expect((await row(s.booking.id)).status).toBe('confirmed');
    expect(spy).not.toHaveBeenCalled();
  });

  it('AC 6: a booking on a cancelled class gives 409 CLASS_CANCELLED and stays unchanged', async () => {
    const app = await createApp();
    const s = await setup(app, 3 * HOUR, { classStatus: 'cancelled' });
    const before = JSON.stringify(await row(s.booking.id));

    const res = await cancel(app, s.booking.id, s.cookie);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'CLASS_CANCELLED', message: 'This class has been cancelled.' });
    expect(JSON.stringify(await row(s.booking.id))).toBe(before);
    expect(spy).not.toHaveBeenCalled();
  });

  it('AC 7: raises exactly one BookingCancelled event with the full payload', async () => {
    const app = await createApp();
    const s = await setup(app, 3 * HOUR);

    await cancel(app, s.booking.id, s.cookie);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toEqual({
      type: 'BookingCancelled',
      bookingId: s.booking.id,
      classId: s.cls.id,
      memberId: s.member.id,
      previousStatus: 'confirmed',
      cancelledAt: T,
      cause: 'member_cancelled',
    });
  });

  it('AC 7: two parallel cancels give one 200, one 409 BOOKING_ALREADY_CANCELLED and one event', async () => {
    const app = await createApp();
    const s = await setup(app, 3 * HOUR);

    const results = await Promise.all([
      cancel(app, s.booking.id, s.cookie),
      cancel(app, s.booking.id, s.cookie),
    ]);

    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.statusCode === 409)?.json().code).toBe('BOOKING_ALREADY_CANCELLED');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('AC 7: a failing event subscriber rolls the cancel back and answers 500', async () => {
    const app = await createApp({ failingSubscriber: true });
    const s = await setup(app, 3 * HOUR);

    const res = await cancel(app, s.booking.id, s.cookie);

    expect(res.statusCode).toBe(500);
    expect(await row(s.booking.id)).toMatchObject({ status: 'confirmed', cancelled_at: null });
    expect(await countActiveBookings(db, s.cls.id)).toBe(1);
  });

  it('AC 8: with a cut-off of 90 a class starting in 100 minutes can be cancelled', async () => {
    const app = await createApp({ cutoff: 90 });
    const s = await setup(app, 100 * MINUTE);
    expect((await cancel(app, s.booking.id, s.cookie)).statusCode).toBe(200);
  });

  it('AC 8: with a cut-off of 90 the rejection names 90 minutes, and canCancel follows the cut-off', async () => {
    const app = await createApp({ cutoff: 90 });
    const s = await setup(app, 80 * MINUTE);

    const listed = await app.inject({ method: 'GET', url: `/api/bookings/${s.booking.id}`, headers: { cookie: s.cookie } });
    expect(listed.json()).toMatchObject({
      canCancel: false,
      cancelDeadline: new Date(T.getTime() - 10 * MINUTE).toISOString(),
    });

    const res = await cancel(app, s.booking.id, s.cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('Bookings can only be cancelled up to 90 minutes before the class starts.');
  });

  it('rejects a malformed booking id with 400', async () => {
    const app = await createApp();
    const s = await setup(app, 3 * HOUR);
    const res = await cancel(app, 'not-a-uuid', s.cookie);
    expect(res.statusCode).toBe(400);
  });
});
