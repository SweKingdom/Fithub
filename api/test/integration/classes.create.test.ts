import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { Clock } from '../../src/shared/clock.js';
import { signInAs } from '../helpers/auth.js';
import { getTestDb, resetDb } from '../helpers/db.js';
import { createClub, createUser } from '../helpers/factories.js';

// The helpers (`signInAs`, `createClub`, `createUser`) come from US-117/US-118 and are used
// as described in the US-120 spec: factories return the inserted row, `signInAs` returns
// request headers carrying the session cookie.

const NOW = new Date('2026-11-01T10:00:00Z');
const clock: Clock = { now: () => NOW };
const VALID_AT = '2026-11-02T17:00:00Z';
const UNKNOWN_ID = '99999999-9999-4999-8999-999999999999';

const db = getTestDb();
let app: FastifyInstance;

async function classCount(): Promise<number> {
  const row = await db
    .selectFrom('gym_class')
    .select(sql<string>`count(*)`.as('n'))
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

async function post(headers: Record<string, string>, body: unknown) {
  return app.inject({ method: 'POST', url: '/api/classes', headers, payload: body as object });
}

describe('POST /api/classes', () => {
  beforeEach(async () => {
    await resetDb(db);
    app = buildApp({ config: loadConfig(process.env), db, clock });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
  });

  async function setup() {
    const clubA = await createClub({ timezone: 'Europe/Stockholm' });
    const clubB = await createClub();
    const instructor = await createUser({ role: 'instructor', clubId: clubA.id });
    const manager = await createUser({ role: 'club_manager', clubId: clubA.id });
    const member = await createUser({ role: 'member', clubId: clubA.id });
    const otherInstructor = await createUser({ role: 'instructor', clubId: clubA.id });
    const foreignInstructor = await createUser({ role: 'instructor', clubId: clubB.id });
    const valid = {
      clubId: clubA.id,
      name: 'Spinning 45',
      startAt: VALID_AT,
      durationMinutes: 45,
      capacity: 20,
    };
    return { clubA, clubB, instructor, manager, member, otherInstructor, foreignInstructor, valid };
  }

  it('AC 1: an instructor creates a valid class', async () => {
    const s = await setup();
    const res = await post(await signInAs(app, s.instructor), { ...s.valid, status: 'cancelled' });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; freePlaces: number }>();
    expect(res.headers.location).toBe(`/api/classes/${body.id}`);
    expect(body.freePlaces).toBe(20);

    const row = await db
      .selectFrom('gym_class')
      .selectAll()
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('scheduled');
    expect(row.name).toBe('Spinning 45');
    expect(row.capacity).toBe(20);
    expect(row.duration_minutes).toBe(45);
    expect(row.start_at.toISOString()).toBe('2026-11-02T17:00:00.000Z');
    expect(row.instructor_id).toBe(s.instructor.id);
    expect(row.created_by).toBe(s.instructor.id);
  });

  it.each([
    ['empty', ''],
    ['spaces', '   '],
    ['missing', undefined],
  ])('AC 2: name %s is rejected', async (_label, name) => {
    const s = await setup();
    const res = await post(await signInAs(app, s.instructor), { ...s.valid, name });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: [{ field: 'name', message: 'A class must have a name.' }],
    });
    expect(await classCount()).toBe(0);
  });

  it.each([0, -1])('AC 3: capacity %s is rejected', async (capacity) => {
    const s = await setup();
    const res = await post(await signInAs(app, s.instructor), { ...s.valid, capacity });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: [{ field: 'capacity', message: 'A class must have at least one place.' }],
    });
    expect(await classCount()).toBe(0);
  });

  it.each([
    ['startAt', { startAt: '2026-10-31T17:00:00Z' }, 'The start time must be in the future.'],
    ['startAt', { startAt: 'tomorrow' }, 'Enter a valid start date and time.'],
    ['startAt', { startAt: '2026-11-02T17:00:00' }, 'Enter a valid start date and time.'],
    [
      'durationMinutes',
      { durationMinutes: 0 },
      'The duration must be a whole number of minutes greater than 0.',
    ],
    ['capacity', { capacity: 2.5 }, 'Max places must be a whole number.'],
    ['capacity', { capacity: 'ten' }, 'Max places must be a whole number.'],
    ['name', { name: 'a'.repeat(101) }, 'The class name can be at most 100 characters.'],
  ])('AC 4: invalid %s → field message', async (field, patch, message) => {
    const s = await setup();
    const res = await post(await signInAs(app, s.instructor), { ...s.valid, ...patch });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ fieldErrors: unknown[] }>().fieldErrors).toEqual([{ field, message }]);
    expect(await classCount()).toBe(0);
  });

  it('AC 4: an empty name and zero places are reported together', async () => {
    const s = await setup();
    const res = await post(await signInAs(app, s.instructor), { ...s.valid, name: '', capacity: 0 });
    expect(res.statusCode).toBe(400);
    const fieldErrors = res.json<{ fieldErrors: { field: string }[] }>().fieldErrors;
    expect(fieldErrors.map((e) => e.field).sort()).toEqual(['capacity', 'name']);
  });

  it('AC 5: a member gets 403 for a valid and for an invalid body', async () => {
    const s = await setup();
    const headers = await signInAs(app, s.member);
    for (const body of [s.valid, { ...s.valid, name: '', capacity: 0 }]) {
      const res = await post(headers, body);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({
        code: 'FORBIDDEN',
        message: 'Only instructors and club managers can manage classes.',
      });
    }
    expect(await classCount()).toBe(0);
  });

  it('AC 5: an anonymous caller gets 401', async () => {
    const s = await setup();
    const res = await post({}, s.valid);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' });
    expect(await classCount()).toBe(0);
  });

  it.each(['instructor', 'manager'] as const)(
    'AC 6: %s of club A cannot create for club B or an unknown club',
    async (who) => {
      const s = await setup();
      const headers = await signInAs(app, s[who]);
      for (const clubId of [s.clubB.id, UNKNOWN_ID]) {
        const res = await post(headers, { ...s.valid, clubId });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({
          code: 'FORBIDDEN',
          message: 'You can only manage classes for your own club.',
        });
      }
      expect(await classCount()).toBe(0);
    },
  );

  it('AC 7: a manager picks an instructor of the same club', async () => {
    const s = await setup();
    const res = await post(await signInAs(app, s.manager), {
      ...s.valid,
      instructorId: s.otherInstructor.id,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; instructorId: string }>();
    expect(body.instructorId).toBe(s.otherInstructor.id);
    const row = await db
      .selectFrom('gym_class')
      .select(['instructor_id', 'created_by'])
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow();
    expect(row.instructor_id).toBe(s.otherInstructor.id);
    expect(row.created_by).toBe(s.manager.id);
  });

  it.each([{ label: 'absent' }, { label: 'null', instructorId: null }])(
    'AC 7: a manager with instructorId $label creates a class without instructor',
    async (patch) => {
      const s = await setup();
      const { label: _label, ...extra } = patch;
      const res = await post(await signInAs(app, s.manager), { ...s.valid, ...extra });
      expect(res.statusCode).toBe(201);
      expect(res.json<{ instructorId: string | null }>().instructorId).toBeNull();
    },
  );

  it('AC 7: a manager cannot pick a member, an unknown id or an instructor of another club', async () => {
    const s = await setup();
    const headers = await signInAs(app, s.manager);
    for (const instructorId of [s.member.id, UNKNOWN_ID, s.foreignInstructor.id]) {
      const res = await post(headers, { ...s.valid, instructorId });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        code: 'VALIDATION_ERROR',
        fieldErrors: [{ field: 'instructorId', message: 'Choose an instructor from this club.' }],
      });
    }
    expect(await classCount()).toBe(0);
  });

  it('AC 7: an instructor cannot assign someone else', async () => {
    const s = await setup();
    const res = await post(await signInAs(app, s.instructor), {
      ...s.valid,
      instructorId: s.otherInstructor.id,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      fieldErrors: [
        { field: 'instructorId', message: 'You can only create classes that you lead yourself.' },
      ],
    });
    expect(await classCount()).toBe(0);
  });

  it('DB: a direct insert with capacity 0 violates gym_class_capacity_ck', async () => {
    const s = await setup();
    await expect(
      db
        .insertInto('gym_class')
        .values({
          club_id: s.clubA.id,
          name: 'Zero',
          start_at: new Date(VALID_AT),
          duration_minutes: 30,
          capacity: 0,
          status: 'scheduled',
          instructor_id: null,
          created_by: s.manager.id,
        })
        .execute(),
    ).rejects.toThrow(/gym_class_capacity_ck/);
  });
});
