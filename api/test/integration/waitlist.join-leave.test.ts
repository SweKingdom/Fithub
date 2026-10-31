import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createWaitlistEntry } from '../helpers/waitlist.js';
// Shared helpers from TK-119 / US-117 / US-118 / US-120 / US-122 (not on this branch, see manual steps).
import { testDb, resetDb } from '../helpers/db.js';
import { createBooking, createClass, createClub, createUser, signInAs } from '../helpers/factories.js';

const NOW = new Date('2026-11-01T10:00:00Z');
const IN_ONE_DAY = new Date('2026-11-02T10:00:00Z');
const clock = { now: () => NOW };

async function setup(env: NodeJS.ProcessEnv = {}) {
  const app = await buildApp({ config: loadConfig(env), db: testDb, clock });
  const club = await createClub({});
  const member = (n: string) => createUser({ role: 'member', clubId: club.id, fullName: `Member ${n}` });
  return { app, club, member };
}

async function fullClass(clubId: string, capacity = 2, startAt = IN_ONE_DAY) {
  const gymClass = await createClass({ clubId, startAt, capacity });
  for (let i = 0; i < capacity; i++) {
    const booked = await createUser({ role: 'member', clubId });
    await createBooking({ classId: gymClass.id, memberId: booked.id, status: 'confirmed' });
  }
  return gymClass;
}

const count = async (table: 'waitlist_entry' | 'booking', where?: { class_id: string }) => {
  let query = testDb.selectFrom(table).select((eb) => eb.fn.countAll<string>().as('n'));
  if (where) query = query.where('class_id', '=', where.class_id);
  return Number((await query.executeTakeFirstOrThrow()).n);
};

beforeEach(resetDb);
afterAll(() => testDb.destroy());

describe('POST /api/classes/:classId/waitlist', () => {
  it('AC 1: joins a full class; positions are 1-based in join order', async () => {
    const { app, club, member } = await setup();
    const gymClass = await fullClass(club.id);
    const [a, b] = [await member('A'), await member('B')];
    const bookingsBefore = await count('booking', { class_id: gymClass.id });

    const first = await app.inject({ method: 'POST', url: `/api/classes/${gymClass.id}/waitlist`, headers: await signInAs(app, a) });
    const second = await app.inject({ method: 'POST', url: `/api/classes/${gymClass.id}/waitlist`, headers: await signInAs(app, b) });

    expect(first.statusCode).toBe(201);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.json()).toMatchObject({ type: 'waitlist', classId: gymClass.id, status: 'waiting', position: 1 });
    expect(second.json()).toMatchObject({ status: 'waiting', position: 2 });
    expect(first.json()).not.toHaveProperty('memberId');

    const rows = await testDb.selectFrom('waitlist_entry').selectAll().orderBy('queue_seq').execute();
    expect(rows.map((r) => [r.member_id, r.status])).toEqual([[a.id, 'waiting'], [b.id, 'waiting']]);
    expect(rows[0]?.joined_at).toEqual(NOW);
    expect(await count('booking', { class_id: gymClass.id })).toBe(bookingsBefore);
  });

  it('AC 2: a class with a free place is not joinable and stores nothing', async () => {
    const { app, club, member } = await setup();
    const gymClass = await createClass({ clubId: club.id, startAt: IN_ONE_DAY, capacity: 2 });
    const booked = await member('X');
    await createBooking({ classId: gymClass.id, memberId: booked.id, status: 'confirmed' });

    const res = await app.inject({ method: 'POST', url: `/api/classes/${gymClass.id}/waitlist`, headers: await signInAs(app, await member('A')) });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'CLASS_NOT_FULL', message: 'This class has free places – book directly.' });
    expect(await count('waitlist_entry')).toBe(0);
  });

  it('AC 3: joining twice is rejected with ALREADY_ON_WAITLIST', async () => {
    const { app, club, member } = await setup();
    const gymClass = await fullClass(club.id);
    const headers = await signInAs(app, await member('A'));
    await app.inject({ method: 'POST', url: `/api/classes/${gymClass.id}/waitlist`, headers });

    const again = await app.inject({ method: 'POST', url: `/api/classes/${gymClass.id}/waitlist`, headers });

    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: 'ALREADY_ON_WAITLIST', message: 'You are already on the waiting list for this class.' });
    expect(await count('waitlist_entry')).toBe(1);
  });

  it.each(['confirmed', 'pending_payment'] as const)('AC 3: a %s booking blocks joining with ALREADY_BOOKED', async (status) => {
    const { app, club, member } = await setup();
    const gymClass = await createClass({ clubId: club.id, startAt: IN_ONE_DAY, capacity: 1 });
    const booker = await member('A');
    await createBooking({ classId: gymClass.id, memberId: booker.id, status });

    const res = await app.inject({ method: 'POST', url: `/api/classes/${gymClass.id}/waitlist`, headers: await signInAs(app, booker) });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'ALREADY_BOOKED', message: 'You have already booked this class.' });
    expect(await count('waitlist_entry')).toBe(0);
  });

  it('AC 3: five parallel joins by one member give one 201, four ALREADY_ON_WAITLIST and one row', async () => {
    const { app, club, member } = await setup();
    const gymClass = await fullClass(club.id);
    const headers = await signInAs(app, await member('A'));

    const results = await Promise.all(
      Array.from({ length: 5 }, () => app.inject({ method: 'POST', url: `/api/classes/${gymClass.id}/waitlist`, headers })),
    );

    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    const rejected = results.filter((r) => r.statusCode === 409);
    expect(rejected).toHaveLength(4);
    expect(rejected.every((r) => r.json().code === 'ALREADY_ON_WAITLIST')).toBe(true);
    expect(await count('waitlist_entry')).toBe(1);
  });

  it('AC 3: a member who left may join again at the end of the queue', async () => {
    const { app, club, member } = await setup();
    const gymClass = await fullClass(club.id);
    const [a, b] = [await member('A'), await member('B')];
    const left = await createWaitlistEntry(testDb, { classId: gymClass.id, memberId: a.id });
    await createWaitlistEntry(testDb, { classId: gymClass.id, memberId: b.id });
    await app.inject({ method: 'DELETE', url: `/api/waitlist/${left.id}`, headers: await signInAs(app, a) });

    const res = await app.inject({ method: 'POST', url: `/api/classes/${gymClass.id}/waitlist`, headers: await signInAs(app, a) });

    expect(res.statusCode).toBe(201);
    expect(res.json().position).toBe(2);
  });

  it('AC 5: unknown class → 404 CLASS_NOT_FOUND; malformed id → 400 VALIDATION_ERROR', async () => {
    const { app, member } = await setup();
    const headers = await signInAs(app, await member('A'));

    const unknown = await app.inject({ method: 'POST', url: '/api/classes/9b2f1c7e-4d0a-4c55-9e0e-3f6a1d2b7c10/waitlist', headers });
    const malformed = await app.inject({ method: 'POST', url: '/api/classes/abc/waitlist', headers });

    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe('CLASS_NOT_FOUND');
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().code).toBe('VALIDATION_ERROR');
  });

  it.each(['instructor', 'club_manager'] as const)('AC 5: a %s gets 403 before validation', async (role) => {
    const { app, club } = await setup();
    const staff = await createUser({ role, clubId: club.id });
    const headers = await signInAs(app, staff);

    const valid = await app.inject({ method: 'POST', url: '/api/classes/9b2f1c7e-4d0a-4c55-9e0e-3f6a1d2b7c10/waitlist', headers });
    const malformed = await app.inject({ method: 'POST', url: '/api/classes/abc/waitlist', headers });

    for (const res of [valid, malformed]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: 'FORBIDDEN', message: 'Only members can join waiting lists.' });
    }
  });

  it('AC 5: anonymous → 401 with the flat envelope, also with a malformed id', async () => {
    const { app } = await setup();

    for (const url of ['/api/classes/abc/waitlist', '/api/classes/9b2f1c7e-4d0a-4c55-9e0e-3f6a1d2b7c10/waitlist']) {
      const res = await app.inject({ method: 'POST', url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' });
    }
  });

  it.each(['started', 'cancelled'] as const)('AC 6: a %s class → 409 CLASS_NOT_BOOKABLE and no row', async (kind) => {
    const { app, club, member } = await setup();
    const gymClass = await createClass({
      clubId: club.id,
      startAt: kind === 'started' ? new Date('2026-11-01T09:00:00Z') : IN_ONE_DAY,
      capacity: 1,
      status: kind === 'cancelled' ? 'cancelled' : 'scheduled',
    });

    const res = await app.inject({ method: 'POST', url: `/api/classes/${gymClass.id}/waitlist`, headers: await signInAs(app, await member('A')) });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'CLASS_NOT_BOOKABLE', message: 'This class can no longer be booked.' });
    expect(await count('waitlist_entry')).toBe(0);
  });

  it('AC 6: cut-off 30 and a class starting in 20 minutes → 409 WAITLIST_CLOSED and no row', async () => {
    const { app, club, member } = await setup({ WAITLIST_PROMOTION_CUTOFF_MINUTES: '30' });
    const gymClass = await fullClass(club.id, 1, new Date(NOW.getTime() + 20 * 60_000));

    const res = await app.inject({ method: 'POST', url: `/api/classes/${gymClass.id}/waitlist`, headers: await signInAs(app, await member('A')) });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'WAITLIST_CLOSED', message: 'The waiting list for this class is closed.' });
    expect(await count('waitlist_entry')).toBe(0);
  });

  it('AC 6: with cut-off 30 a class starting in 40 minutes is still joinable', async () => {
    const { app, club, member } = await setup({ WAITLIST_PROMOTION_CUTOFF_MINUTES: '30' });
    const gymClass = await fullClass(club.id, 1, new Date(NOW.getTime() + 40 * 60_000));

    const res = await app.inject({ method: 'POST', url: `/api/classes/${gymClass.id}/waitlist`, headers: await signInAs(app, await member('A')) });

    expect(res.statusCode).toBe(201);
  });
});

describe('DELETE /api/waitlist/:entryId', () => {
  it('AC 4: leaving frees the position, the next member moves up, leaving again → 409', async () => {
    const { app, club, member } = await setup();
    const gymClass = await fullClass(club.id);
    const [a, b] = [await member('A'), await member('B')];
    const entryA = await createWaitlistEntry(testDb, { classId: gymClass.id, memberId: a.id });
    await createWaitlistEntry(testDb, { classId: gymClass.id, memberId: b.id });

    const left = await app.inject({ method: 'DELETE', url: `/api/waitlist/${entryA.id}`, headers: await signInAs(app, a) });

    expect(left.statusCode).toBe(204);
    const row = await testDb.selectFrom('waitlist_entry').selectAll().where('id', '=', entryA.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('removed');
    expect(row.ended_at).toEqual(NOW);
    const rejoin = await app.inject({ method: 'POST', url: `/api/classes/${gymClass.id}/waitlist`, headers: await signInAs(app, await member('C')) });
    expect(rejoin.json().position).toBe(2); // B is now position 1, C joins behind

    const again = await app.inject({ method: 'DELETE', url: `/api/waitlist/${entryA.id}`, headers: await signInAs(app, a) });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: 'WAITLIST_ENTRY_NOT_ACTIVE', message: 'You are no longer on this waiting list.' });
  });

  it('AC 4: a promoted or expired entry cannot be left', async () => {
    const { app, club, member } = await setup();
    const gymClass = await fullClass(club.id);
    const a = await member('A');
    const expired = await createWaitlistEntry(testDb, { classId: gymClass.id, memberId: a.id, status: 'expired' });

    const res = await app.inject({ method: 'DELETE', url: `/api/waitlist/${expired.id}`, headers: await signInAs(app, a) });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('WAITLIST_ENTRY_NOT_ACTIVE');
  });

  it('AC 4: leaving is allowed after the class has started while the entry is waiting', async () => {
    const { app, club, member } = await setup();
    const gymClass = await createClass({ clubId: club.id, startAt: new Date('2026-11-01T09:00:00Z'), capacity: 1 });
    const a = await member('A');
    const entry = await createWaitlistEntry(testDb, { classId: gymClass.id, memberId: a.id });

    const res = await app.inject({ method: 'DELETE', url: `/api/waitlist/${entry.id}`, headers: await signInAs(app, a) });

    expect(res.statusCode).toBe(204);
  });

  it("AC 5: another member's entry and an unknown id are both 404 and the entry is unchanged", async () => {
    const { app, club, member } = await setup();
    const gymClass = await fullClass(club.id);
    const [a, b] = [await member('A'), await member('B')];
    const entryB = await createWaitlistEntry(testDb, { classId: gymClass.id, memberId: b.id });

    const foreign = await app.inject({ method: 'DELETE', url: `/api/waitlist/${entryB.id}`, headers: await signInAs(app, a) });
    const unknown = await app.inject({ method: 'DELETE', url: '/api/waitlist/9b2f1c7e-4d0a-4c55-9e0e-3f6a1d2b7c10', headers: await signInAs(app, a) });

    for (const res of [foreign, unknown]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'WAITLIST_ENTRY_NOT_FOUND', message: 'This waiting-list place does not exist.' });
    }
    const row = await testDb.selectFrom('waitlist_entry').select('status').where('id', '=', entryB.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('waiting');
  });

  it('AC 5: malformed id (member) → 400; staff → 403 even with a malformed id; anonymous → 401', async () => {
    const { app, club, member } = await setup();
    const staff = await createUser({ role: 'instructor', clubId: club.id });

    const bad = await app.inject({ method: 'DELETE', url: '/api/waitlist/abc', headers: await signInAs(app, await member('A')) });
    const forbidden = await app.inject({ method: 'DELETE', url: '/api/waitlist/abc', headers: await signInAs(app, staff) });
    const anonymous = await app.inject({ method: 'DELETE', url: '/api/waitlist/abc' });

    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('VALIDATION_ERROR');
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ code: 'FORBIDDEN', message: 'Only members can join waiting lists.' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' });
  });

  it('lock order: leave and join on the same class in parallel complete without deadlock', async () => {
    const { app, club, member } = await setup();
    const gymClass = await fullClass(club.id);
    const [a, c] = [await member('A'), await member('C')];
    const entryA = await createWaitlistEntry(testDb, { classId: gymClass.id, memberId: a.id });

    const [left, joined] = await Promise.all([
      app.inject({ method: 'DELETE', url: `/api/waitlist/${entryA.id}`, headers: await signInAs(app, a) }),
      app.inject({ method: 'POST', url: `/api/classes/${gymClass.id}/waitlist`, headers: await signInAs(app, c) }),
    ]);

    expect(left.statusCode).toBe(204);
    expect(joined.statusCode).toBe(201);
  });
});

describe('AC 7: direct booking removes the waiting entry', () => {
  it('books with a free place → entry removed in the same transaction', async () => {
    const { app, club, member } = await setup();
    const gymClass = await createClass({ clubId: club.id, startAt: IN_ONE_DAY, capacity: 2 });
    const a = await member('A');
    const entry = await createWaitlistEntry(testDb, { classId: gymClass.id, memberId: a.id });

    const res = await app.inject({ method: 'POST', url: `/api/classes/${gymClass.id}/bookings`, headers: await signInAs(app, a) });

    expect([201, 202]).toContain(res.statusCode);
    const row = await testDb.selectFrom('waitlist_entry').selectAll().where('id', '=', entry.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('removed');
    expect(row.ended_at).not.toBeNull();
  });

  it('a failed booking (CLASS_FULL) leaves the entry waiting', async () => {
    const { app, club, member } = await setup();
    const gymClass = await fullClass(club.id);
    const a = await member('A');
    const entry = await createWaitlistEntry(testDb, { classId: gymClass.id, memberId: a.id });

    const res = await app.inject({ method: 'POST', url: `/api/classes/${gymClass.id}/bookings`, headers: await signInAs(app, a) });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CLASS_FULL');
    const row = await testDb.selectFrom('waitlist_entry').select('status').where('id', '=', entry.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('waiting');
  });
});

describe('waitlist_entry constraints', () => {
  it('a second waiting row for the same member and class fails with 23505', async () => {
    const { club, member } = await setup();
    const gymClass = await createClass({ clubId: club.id, startAt: IN_ONE_DAY, capacity: 1 });
    const a = await member('A');
    await createWaitlistEntry(testDb, { classId: gymClass.id, memberId: a.id });

    await expect(createWaitlistEntry(testDb, { classId: gymClass.id, memberId: a.id })).rejects.toMatchObject({
      code: '23505',
      constraint: 'waitlist_entry_waiting_class_member_uq',
    });
  });

  it('CHECK waitlist_entry_ended_ck rejects a waiting row with ended_at', async () => {
    const { club, member } = await setup();
    const gymClass = await createClass({ clubId: club.id, startAt: IN_ONE_DAY, capacity: 1 });
    const a = await member('A');

    await expect(
      sql`INSERT INTO waitlist_entry (class_id, member_id, status, joined_at, ended_at)
          VALUES (${gymClass.id}, ${a.id}, 'waiting', now(), now())`.execute(testDb),
    ).rejects.toMatchObject({ constraint: 'waitlist_entry_ended_ck' });
  });
});
