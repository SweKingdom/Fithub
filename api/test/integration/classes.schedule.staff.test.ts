import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { signInAs } from '../helpers/auth.js';
import { testDb } from '../helpers/db.js';
import { createClass, createClub, createUser } from '../helpers/factories.js';

const T = new Date('2026-10-30T09:00:00.000Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const at = (offsetMs: number): Date => new Date(T.getTime() + offsetMs);

type App = Awaited<ReturnType<typeof buildApp>>;

describe('GET /api/classes for staff: started classes (US-129 AC 9)', () => {
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

  async function ids(cookie: string, query = ''): Promise<string[]> {
    const res = await app.inject({ method: 'GET', url: `/api/classes${query}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    return res.json().items.map((i: { id: string }) => i.id);
  }

  async function setup() {
    const club = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const other = await createClub(db, { name: 'Club B', timezone: 'Europe/Stockholm' });
    return { club, other };
  }

  it('instructor and club manager of the club also get classes started within the attendance window', async () => {
    const { club } = await setup();
    // 45 min classes: the window closes at start + 45 min + 24 h.
    const justStarted = await createClass(db, { clubId: club.id, startAt: at(-10 * MIN) });
    const yesterday = await createClass(db, { clubId: club.id, startAt: at(-20 * HOUR) });
    await createClass(db, { clubId: club.id, startAt: at(-26 * HOUR) });
    const upcoming = await createClass(db, { clubId: club.id, startAt: at(2 * HOUR) });

    for (const role of ['instructor', 'club_manager'] as const) {
      const staff = await createUser(db, { role, clubId: club.id });
      expect(await ids(await signInAs(app, staff))).toEqual([yesterday.id, justStarted.id, upcoming.id]);
    }
  });

  it('a class whose attendance window closes exactly now is not returned', async () => {
    const { club } = await setup();
    // start + 45 min + 24 h = T
    await createClass(db, { clubId: club.id, startAt: at(-(24 * HOUR + 45 * MIN)) });
    const staff = await createUser(db, { role: 'instructor', clubId: club.id });
    expect(await ids(await signInAs(app, staff))).toEqual([]);
  });

  it('started classes of another club are not returned to staff', async () => {
    const { club, other } = await setup();
    await createClass(db, { clubId: other.id, startAt: at(-HOUR) });
    const staff = await createUser(db, { role: 'instructor', clubId: club.id });
    const cookie = await signInAs(app, staff);
    expect(await ids(cookie)).toEqual([]);
    expect(await ids(cookie, `?clubId=${other.id}`)).toEqual([]);
  });

  it('members never get started classes', async () => {
    const { club } = await setup();
    await createClass(db, { clubId: club.id, startAt: at(-HOUR) });
    const member = await createUser(db, { role: 'member', clubId: club.id });
    expect(await ids(await signInAs(app, member))).toEqual([]);
  });

  it('staff who narrow the start of the period get no started classes', async () => {
    const { club } = await setup();
    await createClass(db, { clubId: club.id, startAt: at(-HOUR) });
    const later = await createClass(db, { clubId: club.id, startAt: at(3 * HOUR) });
    const staff = await createUser(db, { role: 'instructor', clubId: club.id });
    const query = `?from=${encodeURIComponent(at(HOUR).toISOString())}`;
    expect(await ids(await signInAs(app, staff), query)).toEqual([later.id]);
  });
});
