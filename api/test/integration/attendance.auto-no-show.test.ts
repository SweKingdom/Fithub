import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { runAutoNoShowSweep } from '../../src/modules/attendance/auto-no-show.js';
import type { AttendanceRecorded, EventPublisher } from '../../src/shared/domain-events.js';
import { testDb } from '../helpers/db.js';
import { createBooking, createClass, createClub, createUser } from '../helpers/factories.js';

const START = new Date('2026-10-30T09:00:00.000Z');
const DURATION = 60;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
/** The first instant at which the 24 h window of a class starting at START has closed. */
const CLOSED = new Date(START.getTime() + DURATION * MIN + 24 * HOUR);

describe('auto no-show sweep (US-129 AC 8)', () => {
  const db = testDb();
  const enabled = { ...loadConfig({}).attendance, autoNoShowEnabled: true };
  const disabled = loadConfig({}).attendance;
  const published: AttendanceRecorded[] = [];
  const events: EventPublisher = {
    publish: async (_trx, event) => {
      published.push(event as AttendanceRecorded);
    },
  };
  const logger = { error: vi.fn() };

  beforeEach(async () => {
    published.length = 0;
    logger.error.mockReset();
    await db.deleteFrom('booking').execute();
    await db.deleteFrom('gym_class').execute();
  });

  const sweep = (now: Date, config = enabled, publisher: EventPublisher = events) =>
    runAutoNoShowSweep({ db, clock: { now: () => now }, events: publisher, config, logger });

  async function setupClass(startAt = START, status: 'scheduled' | 'cancelled' = 'scheduled') {
    const club = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const instructor = await createUser(db, { role: 'instructor', clubId: club.id });
    const gymClass = await createClass(db, { clubId: club.id, startAt, durationMinutes: DURATION, status });
    const member = () => createUser(db, { role: 'member', clubId: club.id });
    return { club, instructor, gymClass, member };
  }

  const attendanceOf = async (classId: string) =>
    Object.fromEntries(
      (await db.selectFrom('booking').selectAll().where('class_id', '=', classId).execute()).map((row) => [
        row.id,
        row,
      ]),
    );

  it('turns unknown confirmed bookings into no_show with no recorder and one event each', async () => {
    const { instructor, gymClass, member } = await setupClass();
    const unknownA = await createBooking(db, { classId: gymClass.id, memberId: (await member()).id, status: 'confirmed' });
    const unknownB = await createBooking(db, { classId: gymClass.id, memberId: (await member()).id, status: 'confirmed' });
    const attended = await createBooking(db, {
      classId: gymClass.id,
      memberId: (await member()).id,
      status: 'confirmed',
      attendance: 'attended',
      attendanceRecordedBy: instructor.id,
      attendanceRecordedAt: new Date(START.getTime() + 5 * MIN),
    });
    const cancelled = await createBooking(db, { classId: gymClass.id, memberId: (await member()).id, status: 'cancelled' });
    const pending = await createBooking(db, {
      classId: gymClass.id,
      memberId: (await member()).id,
      status: 'pending_payment',
    });

    const result = await sweep(CLOSED);

    expect(result).toEqual({ classes: 1, bookings: 2 });
    const rows = await attendanceOf(gymClass.id);
    for (const booking of [unknownA, unknownB]) {
      expect(rows[booking.id].attendance).toBe('no_show');
      expect(rows[booking.id].attendance_recorded_by).toBeNull();
      expect(rows[booking.id].attendance_recorded_at?.getTime()).toBe(CLOSED.getTime());
    }
    expect(rows[attended.id].attendance).toBe('attended');
    expect(rows[attended.id].attendance_recorded_by).toBe(instructor.id);
    expect(rows[cancelled.id].attendance).toBe('unknown');
    expect(rows[pending.id].attendance).toBe('unknown');
    expect(published.map((event) => event.bookingId).sort()).toEqual([unknownA.id, unknownB.id].sort());
    expect(published.every((event) => event.recordedBy === null && event.previousAttendance === 'unknown')).toBe(true);
    expect(published.every((event) => event.attendance === 'no_show')).toBe(true);
  });

  it('is idempotent: a second run changes and publishes nothing', async () => {
    const { gymClass, member } = await setupClass();
    await createBooking(db, { classId: gymClass.id, memberId: (await member()).id, status: 'confirmed' });
    expect(await sweep(CLOSED)).toEqual({ classes: 1, bookings: 1 });
    const before = await attendanceOf(gymClass.id);
    published.length = 0;

    expect(await sweep(new Date(CLOSED.getTime() + HOUR))).toEqual({ classes: 0, bookings: 0 });

    expect(published).toHaveLength(0);
    expect(await attendanceOf(gymClass.id)).toEqual(before);
  });

  it('does nothing by default (switch off): bookings stay unknown', async () => {
    const { gymClass, member } = await setupClass();
    const booking = await createBooking(db, { classId: gymClass.id, memberId: (await member()).id, status: 'confirmed' });

    expect(await sweep(CLOSED, disabled)).toEqual({ classes: 0, bookings: 0 });

    expect((await attendanceOf(gymClass.id))[booking.id].attendance).toBe('unknown');
    expect(published).toHaveLength(0);
  });

  it('leaves a class alone until its window has closed (exact boundary)', async () => {
    const { gymClass, member } = await setupClass();
    const booking = await createBooking(db, { classId: gymClass.id, memberId: (await member()).id, status: 'confirmed' });

    expect(await sweep(new Date(CLOSED.getTime() - 1))).toEqual({ classes: 0, bookings: 0 });
    expect((await attendanceOf(gymClass.id))[booking.id].attendance).toBe('unknown');

    expect(await sweep(CLOSED)).toEqual({ classes: 1, bookings: 1 });
  });

  it('skips cancelled classes', async () => {
    const { gymClass, member } = await setupClass(START, 'cancelled');
    const booking = await createBooking(db, { classId: gymClass.id, memberId: (await member()).id, status: 'confirmed' });

    expect(await sweep(CLOSED)).toEqual({ classes: 0, bookings: 0 });
    expect((await attendanceOf(gymClass.id))[booking.id].attendance).toBe('unknown');
  });

  it('logs a failing class with its id, rolls it back and continues with the next class', async () => {
    const first = await setupClass(START);
    const second = await setupClass(new Date(START.getTime() + HOUR));
    const firstBooking = await createBooking(db, {
      classId: first.gymClass.id,
      memberId: (await first.member()).id,
      status: 'confirmed',
    });
    const secondBooking = await createBooking(db, {
      classId: second.gymClass.id,
      memberId: (await second.member()).id,
      status: 'confirmed',
    });
    const flaky: EventPublisher = {
      publish: async (trx, event) => {
        if (event.type === 'AttendanceRecorded' && event.classId === first.gymClass.id) throw new Error('boom');
        await events.publish(trx, event);
      },
    };

    const result = await sweep(new Date(CLOSED.getTime() + HOUR), enabled, flaky);

    expect(result).toEqual({ classes: 1, bookings: 1 });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toMatchObject({ classId: first.gymClass.id });
    expect((await attendanceOf(first.gymClass.id))[firstBooking.id].attendance).toBe('unknown');
    expect((await attendanceOf(second.gymClass.id))[secondBooking.id].attendance).toBe('no_show');
  });
});
