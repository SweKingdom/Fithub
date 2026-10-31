import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { WaitlistConfig } from '../../src/config.js';
import { countActiveBookings, lockClassForUpdate } from '../../src/modules/bookings/repository.js';
import { markRemoved } from '../../src/modules/waitlist/repository.js';
import { notifyPromotions, promoteNext, type PromotionContext } from '../../src/modules/waitlist/promotion.js';
import { signInAs } from '../helpers/auth.js';
import { testDb } from '../helpers/db.js';
import {
  createBooking,
  createClass,
  createClub,
  createUser,
  createWaitlistEntry,
} from '../helpers/factories.js';
import { FakeNotifier, createRecordingLogger } from '../helpers/fakes.js';

const T = new Date('2026-10-30T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const fixedClock = (now: Date) => ({ now: () => now });
const waitlistConfig: WaitlistConfig = { promotionCutoffMinutes: 0, jobIntervalSeconds: 60 };

describe('waiting-list promotion (US-128)', () => {
  const db = testDb();
  let app: Awaited<ReturnType<typeof buildApp>>;
  let ctx: PromotionContext;
  let logs: ReturnType<typeof createRecordingLogger>;

  async function cleanUp(): Promise<void> {
    await db.deleteFrom('waitlist_entry').execute();
    await db.deleteFrom('booking').execute();
    await db.deleteFrom('gym_class').execute();
  }

  beforeAll(async () => {
    app = await buildApp({ clock: fixedClock(T) });
  });
  afterAll(async () => {
    await cleanUp();
    await app.close();
  });
  beforeEach(async () => {
    await cleanUp();
    logs = createRecordingLogger();
    ctx = { clock: fixedClock(T), config: waitlistConfig, logger: logs.logger };
  });

  /** A class that starts in 5 hours with `capacity` members booked, so it is full. */
  async function fullClass(capacity: number) {
    const club = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const cls = await createClass(db, { clubId: club.id, startAt: new Date(T.getTime() + 5 * HOUR), capacity });
    const bookings = [];
    for (let i = 0; i < capacity; i++) {
      const member = await createUser(db, { role: 'member', clubId: club.id });
      bookings.push(await createBooking(db, { classId: cls.id, memberId: member.id, status: 'confirmed' }));
    }
    return { club, cls, bookings };
  }

  async function waiting(classId: string, clubId: string, memberType: 'regular' | 'drop_in' = 'regular') {
    const member = await createUser(db, { role: 'member', clubId, memberType });
    const entry = await createWaitlistEntry(db, { classId, memberId: member.id, joinedAt: T });
    return { member, entry };
  }

  /** What US-124's cancel does: lock the class, free the place, promote, all in one transaction. */
  async function cancelAndPromote(bookingId: string, classId: string) {
    return db.transaction().execute(async (trx) => {
      await lockClassForUpdate(trx, classId);
      await trx.updateTable('booking').set({ status: 'cancelled' }).where('id', '=', bookingId).execute();
      return promoteNext(trx, classId, ctx);
    });
  }

  const entryRow = (id: string) =>
    db.selectFrom('waitlist_entry').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  async function positionOf(entryId: string): Promise<number> {
    const entry = await entryRow(entryId);
    const row = await db
      .selectFrom('waitlist_entry')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('class_id', '=', entry.class_id)
      .where('status', '=', 'waiting')
      .where('queue_seq', '<=', entry.queue_seq)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  const bookingsOf = (classId: string, memberId: string) =>
    db.selectFrom('booking').selectAll().where('class_id', '=', classId).where('member_id', '=', memberId).execute();

  it('AC 1: promotes the first member in line, confirmed, from the waiting list', async () => {
    const { club, cls, bookings } = await fullClass(2);
    const a = await waiting(cls.id, club.id);
    const b = await waiting(cls.id, club.id);

    const promotions = await cancelAndPromote(bookings[0].id, cls.id);

    const [booking] = await bookingsOf(cls.id, a.member.id);
    expect(booking).toMatchObject({ status: 'confirmed', source: 'waitlist' });
    expect(booking.booked_at).toEqual(T);
    expect(await entryRow(a.entry.id)).toMatchObject({
      status: 'promoted',
      promoted_booking_id: booking.id,
      ended_at: T,
    });
    expect(promotions).toEqual([
      { entryId: a.entry.id, bookingId: booking.id, memberId: a.member.id, classId: cls.id, bookingStatus: 'confirmed' },
    ]);
    expect((await entryRow(b.entry.id)).status).toBe('waiting');
    expect(await positionOf(b.entry.id)).toBe(1);
    expect(await countActiveBookings(db, cls.id)).toBe(2);
    expect(logs.entries.filter((e) => e.message === 'waitlist.promoted')).toHaveLength(1);
    expect(JSON.stringify(logs.entries)).not.toContain('@example.com');
  });

  it('AC 2: skips a first member who already has an active booking and promotes the next', async () => {
    const { club, cls, bookings } = await fullClass(2);
    const a = await createUser(db, { role: 'member', clubId: club.id });
    await db.updateTable('gym_class').set({ capacity: 3 }).where('id', '=', cls.id).execute();
    const aBooking = await createBooking(db, { classId: cls.id, memberId: a.id, status: 'confirmed' });
    const aEntry = await createWaitlistEntry(db, { classId: cls.id, memberId: a.id, joinedAt: T });
    const b = await waiting(cls.id, club.id);

    await cancelAndPromote(bookings[0].id, cls.id);

    expect(await entryRow(aEntry.id)).toMatchObject({ status: 'removed', ended_at: T, promoted_booking_id: null });
    expect(await bookingsOf(cls.id, a.id)).toHaveLength(1);
    expect((await bookingsOf(cls.id, a.id))[0].id).toBe(aBooking.id);
    expect((await entryRow(b.entry.id)).status).toBe('promoted');
    expect(await bookingsOf(cls.id, b.member.id)).toHaveLength(1);
  });

  it('AC 3: two parallel cancellations promote A and B once each and leave C waiting', async () => {
    const { club, cls, bookings } = await fullClass(2);
    const a = await waiting(cls.id, club.id);
    const b = await waiting(cls.id, club.id);
    const c = await waiting(cls.id, club.id);

    const results = await Promise.all([
      cancelAndPromote(bookings[0].id, cls.id),
      cancelAndPromote(bookings[1].id, cls.id),
    ]);

    expect(results.flat()).toHaveLength(2);
    expect(await bookingsOf(cls.id, a.member.id)).toHaveLength(1);
    expect(await bookingsOf(cls.id, b.member.id)).toHaveLength(1);
    expect((await entryRow(a.entry.id)).status).toBe('promoted');
    expect((await entryRow(b.entry.id)).status).toBe('promoted');
    expect((await entryRow(c.entry.id)).status).toBe('waiting');
    expect(await positionOf(c.entry.id)).toBe(1);
    expect(await countActiveBookings(db, cls.id)).toBe(2);
  });

  it('AC 3: a member who leaves while a place frees ends removed or promoted, never both', async () => {
    for (let round = 0; round < 5; round++) {
      const { club, cls, bookings } = await fullClass(2);
      const a = await waiting(cls.id, club.id);

      // Leave follows the same lock order as US-127: class first, then the entry.
      const leave = db.transaction().execute(async (trx) => {
        await lockClassForUpdate(trx, cls.id);
        return markRemoved(trx, a.entry.id, T);
      });
      await Promise.all([leave, cancelAndPromote(bookings[0].id, cls.id)]);

      const entry = await entryRow(a.entry.id);
      const aBookings = await bookingsOf(cls.id, a.member.id);
      expect(['removed', 'promoted']).toContain(entry.status);
      if (entry.status === 'promoted') {
        expect(aBookings).toHaveLength(1);
        expect(entry.promoted_booking_id).toBe(aBookings[0].id);
      } else {
        expect(aBookings).toHaveLength(0);
        expect(entry.promoted_booking_id).toBeNull();
      }
      expect(await countActiveBookings(db, cls.id)).toBeLessThanOrEqual(2);
    }
  });

  it('AC 4: notifies once per promotion after commit and the schedule shows the booking', async () => {
    const { club, cls, bookings } = await fullClass(2);
    const a = await waiting(cls.id, club.id);
    const notifier = new FakeNotifier();

    const promotions = await cancelAndPromote(bookings[0].id, cls.id);
    expect(notifier.calls).toHaveLength(0);
    await notifyPromotions(promotions, notifier, logs.logger);

    expect(notifier.calls).toEqual([
      { type: 'waitlist_promoted', memberId: a.member.id, bookingId: promotions[0].bookingId, classId: cls.id },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/classes?clubId=${club.id}`,
      headers: { cookie: await signInAs(app, a.member) },
    });
    const item = res.json().items.find((i: { id: string }) => i.id === cls.id);
    expect(item.myBookingStatus).toBe('confirmed');
    expect(item.myBooking).toEqual({ id: promotions[0].bookingId, status: 'confirmed' });
  });

  it('AC 4: a rolled-back transaction promotes nobody and notifies nobody', async () => {
    const { club, cls, bookings } = await fullClass(2);
    const a = await waiting(cls.id, club.id);
    const notifier = new FakeNotifier();

    await expect(
      db.transaction().execute(async (trx) => {
        await trx.updateTable('booking').set({ status: 'cancelled' }).where('id', '=', bookings[0].id).execute();
        const promotions = await promoteNext(trx, cls.id, ctx);
        expect(promotions).toHaveLength(1);
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    expect(notifier.calls).toHaveLength(0);
    expect((await entryRow(a.entry.id)).status).toBe('waiting');
    expect(await bookingsOf(cls.id, a.member.id)).toHaveLength(0);
  });

  it('AC 4: a failing notifier is logged and does not undo the promotion', async () => {
    const { club, cls, bookings } = await fullClass(2);
    const a = await waiting(cls.id, club.id);
    const notifier = new FakeNotifier();
    notifier.failWith = new Error('channel down');

    const promotions = await cancelAndPromote(bookings[0].id, cls.id);
    await expect(notifyPromotions(promotions, notifier, logs.logger)).resolves.toBeUndefined();

    expect(notifier.calls).toHaveLength(1);
    expect((await entryRow(a.entry.id)).status).toBe('promoted');
    expect(await bookingsOf(cls.id, a.member.id)).toHaveLength(1);
    const failure = logs.entries.find((e) => e.message === 'notification.failed');
    expect(failure).toMatchObject({ level: 'error', fields: { memberId: a.member.id, error: 'channel down' } });
  });

  it('AC 5: a waiting drop-in member gets a pending_payment booking that counts as taken', async () => {
    const { club, cls, bookings } = await fullClass(2);
    const a = await waiting(cls.id, club.id, 'drop_in');

    const promotions = await cancelAndPromote(bookings[0].id, cls.id);

    const [booking] = await bookingsOf(cls.id, a.member.id);
    expect(booking).toMatchObject({ status: 'pending_payment', source: 'waitlist' });
    expect(promotions[0].bookingStatus).toBe('pending_payment');
    expect((await entryRow(a.entry.id)).status).toBe('promoted');
    expect(await countActiveBookings(db, cls.id)).toBe(2);
  });

  it('AC 8: a full class changes nothing and returns no promotion', async () => {
    const { club, cls } = await fullClass(2);
    const a = await waiting(cls.id, club.id);

    const promotions = await db.transaction().execute((trx) => promoteNext(trx, cls.id, ctx));

    expect(promotions).toEqual([]);
    expect((await entryRow(a.entry.id)).status).toBe('waiting');
    expect(await countActiveBookings(db, cls.id)).toBe(2);
  });

  it('AC 8: an empty waiting list changes nothing and returns no promotion', async () => {
    const { cls, bookings } = await fullClass(2);

    const promotions = await cancelAndPromote(bookings[0].id, cls.id);

    expect(promotions).toEqual([]);
    expect(await countActiveBookings(db, cls.id)).toBe(1);
    expect(await db.selectFrom('waitlist_entry').selectAll().execute()).toHaveLength(0);
  });

  it('AC 8: an unknown class and a cancelled class are no-ops', async () => {
    const { club, cls, bookings } = await fullClass(2);
    const a = await waiting(cls.id, club.id);
    await db.updateTable('gym_class').set({ status: 'cancelled' }).where('id', '=', cls.id).execute();

    const cancelled = await cancelAndPromote(bookings[0].id, cls.id);
    const unknown = await db
      .transaction()
      .execute((trx) => promoteNext(trx, '00000000-0000-4000-8000-000000000000', ctx));

    expect(cancelled).toEqual([]);
    expect(unknown).toEqual([]);
    expect((await entryRow(a.entry.id)).status).toBe('waiting');
  });

  it('promotes one member per free place, in queue order', async () => {
    const { club, cls, bookings } = await fullClass(3);
    const a = await waiting(cls.id, club.id);
    const b = await waiting(cls.id, club.id);
    const c = await waiting(cls.id, club.id);
    await db.updateTable('booking').set({ status: 'cancelled' }).where('id', 'in', [bookings[0].id, bookings[1].id]).execute();

    const promotions = await db.transaction().execute((trx) => promoteNext(trx, cls.id, ctx));

    expect(promotions.map((p) => p.memberId)).toEqual([a.member.id, b.member.id]);
    expect((await entryRow(c.entry.id)).status).toBe('waiting');
    expect(await countActiveBookings(db, cls.id)).toBe(3);
  });
});
