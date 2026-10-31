import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { AttendanceStatus } from '../../src/db/schema.js';
import { DomainError } from '../../src/shared/errors.js';
import { signInAs } from '../helpers/auth.js';
import { testDb } from '../helpers/db.js';
import { createBooking, createClass, createClub, createUser } from '../helpers/factories.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const T = new Date('2026-10-30T09:00:00.000Z');

type App = Awaited<ReturnType<typeof buildApp>>;

describe('no-show block (US-130)', () => {
  const db = testDb();
  const apps: App[] = [];
  let now = T;
  const clock = { now: () => now };

  afterEach(async () => {
    now = T;
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function makeApp(env: NodeJS.ProcessEnv = {}): Promise<App> {
    const app = await buildApp({ clock, config: loadConfig({ ...process.env, ...env }) });
    apps.push(app);
    return app;
  }

  async function setup() {
    const club = await createClub(db, { name: `Club ${randomUUID()}`, timezone: 'Europe/Stockholm' });
    const member = await createUser(db, { role: 'member', clubId: club.id });
    return { club, member };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  /** A confirmed booking on a class that started `startAt`. */
  async function bookingOn({ club, member }: Setup, startAt: Date, status: 'confirmed' | 'cancelled' = 'confirmed') {
    const gymClass = await createClass(db, { clubId: club.id, startAt });
    const booking = await createBooking(db, { classId: gymClass.id, memberId: member.id, status });
    return { gymClass, booking };
  }

  /** What US-129 does: save the attendance and publish `AttendanceRecorded` in one transaction. */
  async function recordAttendance(
    app: App,
    booking: { id: string; class_id: string; member_id: string },
    classStartAt: Date,
    attendance: AttendanceStatus,
  ): Promise<void> {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('booking')
        .select('attendance')
        .where('id', '=', booking.id)
        .executeTakeFirstOrThrow();
      await trx.updateTable('booking').set({ attendance }).where('id', '=', booking.id).execute();
      await app.events.publish(trx, {
        type: 'AttendanceRecorded',
        bookingId: booking.id,
        memberId: booking.member_id,
        classId: booking.class_id,
        classStartAt,
        previousAttendance: before.attendance,
        attendance,
        recordedBy: null,
        recordedAt: now,
      });
    });
  }

  /** Records a no-show on a new class that started `daysAgo` days before the (fixed) clock. */
  async function noShow(app: App, fixture: Setup, daysAgo: number) {
    const startAt = new Date(now.getTime() - daysAgo * DAY_MS);
    const { booking } = await bookingOn(fixture, startAt);
    await recordAttendance(app, booking, startAt, 'no_show');
    return { booking, startAt };
  }

  const blocksOf = (memberId: string) =>
    db.selectFrom('booking_block').selectAll().where('member_id', '=', memberId).orderBy('created_at').execute();

  const linkedTo = async (blockId: string) =>
    (await db.selectFrom('booking').select('id').where('no_show_block_id', '=', blockId).execute()).map((r) => r.id);

  async function blockedMember(app: App) {
    const fixture = await setup();
    const recorded = [await noShow(app, fixture, 3), await noShow(app, fixture, 2), await noShow(app, fixture, 1)];
    const [block] = await blocksOf(fixture.member.id);
    return { ...fixture, recorded, block };
  }

  it('AC 1: the 3rd no-show in the window creates one 7-day block and links the three bookings', async () => {
    const app = await makeApp();
    const fixture = await setup();
    const recorded = [await noShow(app, fixture, 10), await noShow(app, fixture, 5), await noShow(app, fixture, 1)];

    const blocks = await blocksOf(fixture.member.id);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ reason: 'no_show', no_show_count: 3, lifted_at: null });
    expect(blocks[0].starts_at).toEqual(T);
    expect(blocks[0].ends_at).toEqual(new Date(T.getTime() + 7 * DAY_MS));
    expect((await linkedTo(blocks[0].id)).sort()).toEqual(recorded.map((r) => r.booking.id).sort());
  });

  it('AC 1: the block is created in the transaction of the attendance save (a rollback leaves no block)', async () => {
    const app = await makeApp();
    const fixture = await setup();
    await noShow(app, fixture, 10);
    await noShow(app, fixture, 5);
    const startAt = new Date(now.getTime() - DAY_MS);
    const { booking } = await bookingOn(fixture, startAt);

    await expect(
      db.transaction().execute(async (trx) => {
        await trx.updateTable('booking').set({ attendance: 'no_show' }).where('id', '=', booking.id).execute();
        await app.events.publish(trx, {
          type: 'AttendanceRecorded',
          bookingId: booking.id,
          memberId: fixture.member.id,
          classId: booking.class_id,
          classStartAt: startAt,
          previousAttendance: 'unknown',
          attendance: 'no_show',
          recordedBy: null,
          recordedAt: now,
        });
        throw new Error('attendance save failed');
      }),
    ).rejects.toThrow('attendance save failed');

    expect(await blocksOf(fixture.member.id)).toHaveLength(0);
    const row = await db.selectFrom('booking').select('attendance').where('id', '=', booking.id).executeTakeFirstOrThrow();
    expect(row.attendance).toBe('unknown');
  });

  it('AC 2: two no-shows create no block and the member can still book', async () => {
    const app = await makeApp();
    const fixture = await setup();
    await noShow(app, fixture, 5);
    await noShow(app, fixture, 1);

    expect(await blocksOf(fixture.member.id)).toHaveLength(0);
    expect(await app.blockService.getActiveBlock(db, fixture.member.id)).toBeNull();
    await expect(app.blockService.assertNotBlocked(db, fixture.member.id)).resolves.toBeUndefined();
  });

  it('AC 2: attended, unknown, cancelled and unpaid bookings never count', async () => {
    const app = await makeApp();
    const fixture = await setup();
    await noShow(app, fixture, 5);
    await noShow(app, fixture, 4);
    const attended = await bookingOn(fixture, new Date(now.getTime() - 3 * DAY_MS));
    await recordAttendance(app, attended.booking, attended.gymClass.start_at, 'attended');
    const cancelled = await bookingOn(fixture, new Date(now.getTime() - 2 * DAY_MS), 'cancelled');
    await recordAttendance(app, cancelled.booking, cancelled.gymClass.start_at, 'no_show');
    const unpaid = await bookingOn(fixture, new Date(now.getTime() - DAY_MS));
    await db.updateTable('booking').set({ status: 'pending_payment' }).where('id', '=', unpaid.booking.id).execute();
    await recordAttendance(app, unpaid.booking, unpaid.gymClass.start_at, 'no_show');

    expect(await blocksOf(fixture.member.id)).toHaveLength(0);
  });

  it('AC 3: a blocked member is refused with 409 BOOKING_BLOCKED and the date in club local time', async () => {
    const app = await makeApp();
    const { member } = await blockedMember(app);

    const error = await app.blockService.assertNotBlocked(db, member.id).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({
      code: 'BOOKING_BLOCKED',
      httpStatus: 409,
      message: "You can't book classes until 6 Nov 2026, 10:00 because of 3 missed classes.",
    });
  });

  it('AC 4: the member can book again exactly at ends_at, but not one millisecond before', async () => {
    const app = await makeApp();
    const { member, block } = await blockedMember(app);

    now = new Date(block.ends_at.getTime() - 1);
    await expect(app.blockService.assertNotBlocked(db, member.id)).rejects.toMatchObject({ code: 'BOOKING_BLOCKED' });
    now = block.ends_at;
    await expect(app.blockService.assertNotBlocked(db, member.id)).resolves.toBeUndefined();
    now = new Date(block.ends_at.getTime() + DAY_MS);
    await expect(app.blockService.assertNotBlocked(db, member.id)).resolves.toBeUndefined();
  });

  it('AC 5: NO_SHOW_THRESHOLD=4 blocks at the 4th no-show, NO_SHOW_BLOCK_DAYS=3 sets ends_at', async () => {
    const app = await makeApp({ NO_SHOW_THRESHOLD: '4', NO_SHOW_BLOCK_DAYS: '3' });
    const fixture = await setup();
    await noShow(app, fixture, 4);
    await noShow(app, fixture, 3);
    await noShow(app, fixture, 2);
    expect(await blocksOf(fixture.member.id)).toHaveLength(0);

    await noShow(app, fixture, 1);
    const blocks = await blocksOf(fixture.member.id);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].no_show_count).toBe(4);
    expect(blocks[0].ends_at).toEqual(new Date(T.getTime() + 3 * DAY_MS));
  });

  it('AC 6: after the block ended, one more no-show creates no new block', async () => {
    const app = await makeApp();
    const fixture = await blockedMember(app);

    now = new Date(fixture.block.ends_at.getTime() + DAY_MS);
    await noShow(app, fixture, 0);

    expect(await blocksOf(fixture.member.id)).toHaveLength(1);
  });

  it('AC 6: a no-show during an active block creates no second block and stays uncounted', async () => {
    const app = await makeApp();
    const fixture = await blockedMember(app);

    const during = await noShow(app, fixture, 0);
    expect(await blocksOf(fixture.member.id)).toHaveLength(1);
    const row = await db
      .selectFrom('booking')
      .select('no_show_block_id')
      .where('id', '=', during.booking.id)
      .executeTakeFirstOrThrow();
    expect(row.no_show_block_id).toBeNull();
  });

  it('AC 6: no-shows recorded during a block count towards a later block when still inside the window', async () => {
    const app = await makeApp();
    const fixture = await blockedMember(app);
    await noShow(app, fixture, 0);
    await noShow(app, fixture, 0);

    now = new Date(fixture.block.ends_at.getTime() + 1000);
    await noShow(app, fixture, 0);

    const blocks = await blocksOf(fixture.member.id);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].no_show_count).toBe(3);
  });

  it('AC 6: delivering the same event twice does not create a second block', async () => {
    const app = await makeApp();
    const fixture = await blockedMember(app);
    const last = fixture.recorded[2];

    await recordAttendance(app, last.booking, last.startAt, 'no_show');

    expect(await blocksOf(fixture.member.id)).toHaveLength(1);
  });

  it('AC 7: a no-show on a class that started 31 days ago is not counted', async () => {
    const app = await makeApp();
    const fixture = await setup();
    await noShow(app, fixture, 31);
    await noShow(app, fixture, 5);
    await noShow(app, fixture, 1);
    expect(await blocksOf(fixture.member.id)).toHaveLength(0);

    await noShow(app, fixture, 29);
    const blocks = await blocksOf(fixture.member.id);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].no_show_count).toBe(3);
  });

  it('AC 7: NO_SHOW_WINDOW=calendar_month counts only the club-local month of the third no-show', async () => {
    const app = await makeApp({ NO_SHOW_WINDOW: 'calendar_month' });
    const fixture = await setup();
    now = new Date('2026-10-02T10:00:00.000Z');
    const record = async (startAt: string) => {
      const start = new Date(startAt);
      const { booking } = await bookingOn(fixture, start);
      await recordAttendance(app, booking, start, 'no_show');
    };

    await record('2026-09-30T20:00:00.000Z'); // 30 Sep 22:00 in Stockholm
    await record('2026-10-01T10:00:00.000Z');
    await record('2026-10-02T08:00:00.000Z');
    expect(await blocksOf(fixture.member.id)).toHaveLength(0);

    await record('2026-10-02T09:00:00.000Z');
    // 2 Oct no-shows: 1 Oct, 2 Oct, 2 Oct = 3 in October (the 30 Sep one is outside).
    const blocks = await blocksOf(fixture.member.id);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].no_show_count).toBe(3);
  });

  it('AC 7: a class that started at 00:30 on the 1st in club time counts for calendar_month', async () => {
    const app = await makeApp({ NO_SHOW_WINDOW: 'calendar_month' });
    const fixture = await setup();
    now = new Date('2026-10-02T10:00:00.000Z');
    for (const startAt of ['2026-09-30T22:30:00.000Z', '2026-10-01T10:00:00.000Z', '2026-10-02T08:00:00.000Z']) {
      const { booking } = await bookingOn(fixture, new Date(startAt));
      await recordAttendance(app, booking, new Date(startAt), 'no_show');
    }
    expect(await blocksOf(fixture.member.id)).toHaveLength(1);
  });

  it('AC 8: correcting a linked no-show to attended lifts the block, unlinks the booking and lets the member book', async () => {
    const app = await makeApp();
    const fixture = await blockedMember(app);

    now = new Date(T.getTime() + DAY_MS);
    const corrected = fixture.recorded[0];
    await recordAttendance(app, corrected.booking, corrected.startAt, 'attended');

    const [block] = await blocksOf(fixture.member.id);
    expect(block.ends_at).toEqual(now);
    expect(block.lifted_at).toEqual(now);
    expect(await linkedTo(block.id)).toHaveLength(2);
    const row = await db
      .selectFrom('booking')
      .select('no_show_block_id')
      .where('id', '=', corrected.booking.id)
      .executeTakeFirstOrThrow();
    expect(row.no_show_block_id).toBeNull();
    await expect(app.blockService.assertNotBlocked(db, fixture.member.id)).resolves.toBeUndefined();
  });

  it('AC 8: a correction after the block ended unlinks the booking but changes nothing else', async () => {
    const app = await makeApp();
    const fixture = await blockedMember(app);

    now = new Date(fixture.block.ends_at.getTime() + DAY_MS);
    const corrected = fixture.recorded[0];
    await recordAttendance(app, corrected.booking, corrected.startAt, 'attended');

    const [block] = await blocksOf(fixture.member.id);
    expect(block.ends_at).toEqual(fixture.block.ends_at);
    expect(block.lifted_at).toBeNull();
  });

  it('AC 8: the block stays when enough linked no-shows remain (threshold 2, three linked)', async () => {
    const app = await makeApp({ NO_SHOW_THRESHOLD: '2' });
    const fixture = await setup();
    const first = await noShow(app, fixture, 3);
    await noShow(app, fixture, 2);
    const [block] = await blocksOf(fixture.member.id);
    expect(block.no_show_count).toBe(2);

    // A third booking is linked by hand to model a block that counted more than the threshold.
    const extra = await bookingOn(fixture, new Date(now.getTime() - DAY_MS));
    await db.updateTable('booking').set({ attendance: 'no_show', no_show_block_id: block.id }).where('id', '=', extra.booking.id).execute();

    await recordAttendance(app, first.booking, first.startAt, 'attended');

    const [after] = await blocksOf(fixture.member.id);
    expect(after.lifted_at).toBeNull();
    expect(after.ends_at).toEqual(block.ends_at);
  });

  it('AC 9: the existing bookings of a blocked member stay confirmed', async () => {
    const app = await makeApp();
    const fixture = await setup();
    const upcoming = [
      await bookingOn(fixture, new Date(now.getTime() + DAY_MS)),
      await bookingOn(fixture, new Date(now.getTime() + 2 * DAY_MS)),
    ];
    await noShow(app, fixture, 3);
    await noShow(app, fixture, 2);
    await noShow(app, fixture, 1);
    expect(await blocksOf(fixture.member.id)).toHaveLength(1);

    for (const { booking } of upcoming) {
      const row = await db.selectFrom('booking').select('status').where('id', '=', booking.id).executeTakeFirstOrThrow();
      expect(row.status).toBe('confirmed');
    }
  });

  it('AC 10: GET /api/me returns the block with its message, and null when not blocked', async () => {
    const app = await makeApp();
    const blocked = await blockedMember(app);
    const free = await setup();

    const blockedMe = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: await signInAs(app, blocked.member, clock) },
    });
    expect(blockedMe.statusCode).toBe(200);
    expect(blockedMe.json().bookingBlock).toEqual({
      endsAt: '2026-11-06T09:00:00.000Z',
      reason: 'no_show',
      noShowCount: 3,
      message: "You can't book classes until 6 Nov 2026, 10:00 because of 3 missed classes.",
    });

    const freeMe = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: await signInAs(app, free.member, clock) },
    });
    expect(freeMe.json().bookingBlock).toBeNull();
  });

  it('AC 10: GET /api/me always returns null for staff', async () => {
    const app = await makeApp();
    const { club } = await setup();
    const manager = await createUser(db, { role: 'club_manager', clubId: club.id });
    await db
      .insertInto('booking_block')
      .values({
        member_id: manager.id,
        reason: 'no_show',
        starts_at: new Date(T.getTime() - DAY_MS),
        ends_at: new Date(T.getTime() + DAY_MS),
        no_show_count: 3,
      })
      .execute();

    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: await signInAs(app, manager, clock) },
    });
    expect(response.json().bookingBlock).toBeNull();
  });

  it('a manual block shows the shorter message', async () => {
    const app = await makeApp();
    const { member } = await setup();
    await db
      .insertInto('booking_block')
      .values({
        member_id: member.id,
        reason: 'manual',
        starts_at: new Date(T.getTime() - DAY_MS),
        ends_at: new Date(T.getTime() + DAY_MS),
        no_show_count: null,
      })
      .execute();

    await expect(app.blockService.assertNotBlocked(db, member.id)).rejects.toMatchObject({
      code: 'BOOKING_BLOCKED',
      message: "You can't book classes until 31 Oct 2026, 10:00.",
    });
  });

  it('concurrency: two parallel attendance saves that each reach the threshold create exactly one block', async () => {
    const app = await makeApp();
    const fixture = await setup();
    await noShow(app, fixture, 5);
    const startA = new Date(now.getTime() - 2 * DAY_MS);
    const startB = new Date(now.getTime() - DAY_MS);
    const a = await bookingOn(fixture, startA);
    const b = await bookingOn(fixture, startB);

    await Promise.all([
      recordAttendance(app, a.booking, startA, 'no_show'),
      recordAttendance(app, b.booking, startB, 'no_show'),
    ]);

    const blocks = await blocksOf(fixture.member.id);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].no_show_count).toBe(3);
    expect(await linkedTo(blocks[0].id)).toHaveLength(3);
  });
});
