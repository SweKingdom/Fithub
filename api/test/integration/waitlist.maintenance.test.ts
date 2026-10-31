import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { WaitlistConfig } from '../../src/config.js';
import type { Database } from '../../src/db/schema.js';
import { runWaitlistMaintenance } from '../../src/modules/waitlist/maintenance.js';
import { promoteNext } from '../../src/modules/waitlist/promotion.js';
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
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const fixedClock = (now: Date) => ({ now: () => now });
const config = (promotionCutoffMinutes: number): WaitlistConfig => ({ promotionCutoffMinutes, jobIntervalSeconds: 60 });

describe('waiting-list maintenance job (US-128)', () => {
  const db = testDb();
  let notifier: FakeNotifier;
  let logs: ReturnType<typeof createRecordingLogger>;

  async function cleanUp(): Promise<void> {
    await db.deleteFrom('waitlist_entry').execute();
    await db.deleteFrom('booking').execute();
    await db.deleteFrom('gym_class').execute();
  }

  afterAll(cleanUp);
  beforeEach(async () => {
    await cleanUp();
    notifier = new FakeNotifier();
    logs = createRecordingLogger();
  });

  const run = (now: Date, cutoff: number, target: Kysely<Database> = db) =>
    runWaitlistMaintenance({
      db: target,
      clock: fixedClock(now),
      config: config(cutoff),
      notifier,
      logger: logs.logger,
    });

  async function setup(startOffsetMs: number, capacity = 2) {
    const club = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const cls = await createClass(db, { clubId: club.id, startAt: new Date(T.getTime() + startOffsetMs), capacity });
    return { club, cls };
  }

  async function member(clubId: string) {
    return createUser(db, { role: 'member', clubId });
  }

  const entryRow = (id: string) =>
    db.selectFrom('waitlist_entry').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const activeCount = async (classId: string) =>
    (await db.selectFrom('booking').select('id').where('class_id', '=', classId).where('status', '!=', 'cancelled').execute())
      .length;

  it('AC 6: with cut-off 0, entries of a started class expire; promoted and removed entries stay', async () => {
    const { club, cls } = await setup(-10 * MIN);
    const w1 = await createWaitlistEntry(db, { classId: cls.id, memberId: (await member(club.id)).id });
    const w2 = await createWaitlistEntry(db, { classId: cls.id, memberId: (await member(club.id)).id });
    const promoted = await createWaitlistEntry(db, {
      classId: cls.id,
      memberId: (await member(club.id)).id,
      status: 'promoted',
      joinedAt: new Date(T.getTime() - HOUR),
    });
    const removed = await createWaitlistEntry(db, {
      classId: cls.id,
      memberId: (await member(club.id)).id,
      status: 'removed',
      joinedAt: new Date(T.getTime() - HOUR),
    });

    const result = await run(T, 0);

    expect(result).toEqual({ expired: 2, promoted: 0 });
    expect(await entryRow(w1.id)).toMatchObject({ status: 'expired', ended_at: T });
    expect(await entryRow(w2.id)).toMatchObject({ status: 'expired', ended_at: T });
    expect((await entryRow(promoted.id)).status).toBe('promoted');
    expect((await entryRow(promoted.id)).ended_at).toEqual(promoted.ended_at);
    expect((await entryRow(removed.id)).status).toBe('removed');
    expect((await entryRow(removed.id)).ended_at).toEqual(removed.ended_at);
  });

  it('AC 6: with cut-off 0, entries of a class that has not started are left waiting', async () => {
    const { club, cls } = await setup(HOUR, 1);
    await createBooking(db, { classId: cls.id, memberId: (await member(club.id)).id, status: 'confirmed' });
    const entry = await createWaitlistEntry(db, { classId: cls.id, memberId: (await member(club.id)).id });

    const result = await run(T, 0);

    expect(result).toEqual({ expired: 0, promoted: 0 });
    expect((await entryRow(entry.id)).status).toBe('waiting');
  });

  it('AC 6: with cut-off 30, a place freed 20 minutes before start is not promoted and the job expires the entries', async () => {
    const { club, cls } = await setup(20 * MIN, 1);
    const entry = await createWaitlistEntry(db, { classId: cls.id, memberId: (await member(club.id)).id });

    const promotions = await db
      .transaction()
      .execute((trx) => promoteNext(trx, cls.id, { clock: fixedClock(T), config: config(30), logger: logs.logger }));
    expect(promotions).toEqual([]);

    const result = await run(T, 30);

    expect(result).toEqual({ expired: 1, promoted: 0 });
    expect(await entryRow(entry.id)).toMatchObject({ status: 'expired', ended_at: T });
    expect(await activeCount(cls.id)).toBe(0);
    expect(notifier.calls).toHaveLength(0);
  });

  it('AC 7: promotes into a free place that no trigger handled; a second run changes nothing', async () => {
    const { club, cls } = await setup(5 * HOUR, 2);
    await createBooking(db, { classId: cls.id, memberId: (await member(club.id)).id, status: 'confirmed' });
    const a = await member(club.id);
    const b = await member(club.id);
    const aEntry = await createWaitlistEntry(db, { classId: cls.id, memberId: a.id });
    const bEntry = await createWaitlistEntry(db, { classId: cls.id, memberId: b.id });

    const first = await run(T, 0);

    expect(first).toEqual({ expired: 0, promoted: 1 });
    expect(await entryRow(aEntry.id)).toMatchObject({ status: 'promoted', ended_at: T });
    expect((await entryRow(bEntry.id)).status).toBe('waiting');
    const booking = await db.selectFrom('booking').selectAll().where('member_id', '=', a.id).executeTakeFirstOrThrow();
    expect(booking).toMatchObject({ status: 'confirmed', source: 'waitlist' });
    expect(notifier.calls).toEqual([
      { type: 'waitlist_promoted', memberId: a.id, bookingId: booking.id, classId: cls.id },
    ]);
    expect(await activeCount(cls.id)).toBe(2);

    const second = await run(T, 0);

    expect(second).toEqual({ expired: 0, promoted: 0 });
    expect(notifier.calls).toHaveLength(1);
    expect(await activeCount(cls.id)).toBe(2);
    expect((await entryRow(bEntry.id)).status).toBe('waiting');
  });

  it('AC 8: a full class and a class without waiting entries are left alone', async () => {
    const full = await setup(5 * HOUR, 1);
    await createBooking(db, { classId: full.cls.id, memberId: (await member(full.club.id)).id, status: 'confirmed' });
    const entry = await createWaitlistEntry(db, { classId: full.cls.id, memberId: (await member(full.club.id)).id });
    await setup(6 * HOUR, 5);

    const result = await run(T, 0);

    expect(result).toEqual({ expired: 0, promoted: 0 });
    expect((await entryRow(entry.id)).status).toBe('waiting');
    expect(notifier.calls).toHaveLength(0);
  });

  it('does not promote into a cancelled class', async () => {
    const { club, cls } = await setup(5 * HOUR, 2);
    await db.updateTable('gym_class').set({ status: 'cancelled' }).where('id', '=', cls.id).execute();
    const entry = await createWaitlistEntry(db, { classId: cls.id, memberId: (await member(club.id)).id });

    const result = await run(T, 0);

    expect(result.promoted).toBe(0);
    expect((await entryRow(entry.id)).status).toBe('waiting');
  });

  it('one class failing is logged and does not stop the other classes', async () => {
    const first = await setup(2 * HOUR, 1);
    const second = await setup(3 * HOUR, 1);
    await createWaitlistEntry(db, { classId: first.cls.id, memberId: (await member(first.club.id)).id });
    const b = await member(second.club.id);
    const bEntry = await createWaitlistEntry(db, { classId: second.cls.id, memberId: b.id });

    // The first transaction fails; later ones use the real database.
    let transactions = 0;
    const flaky = new Proxy(db, {
      get(target, property) {
        if (property === 'transaction') {
          return () => {
            transactions += 1;
            if (transactions === 1) throw new Error('database unavailable');
            return target.transaction();
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const result = await run(T, 0, flaky);

    expect(result.promoted).toBe(1);
    expect((await entryRow(bEntry.id)).status).toBe('promoted');
    expect(logs.entries.find((e) => e.message === 'waitlist.sweep_failed')).toMatchObject({
      level: 'error',
      fields: { classId: first.cls.id, error: 'database unavailable' },
    });
  });
});
