import { sql, type Kysely } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ClubDatabase } from '../../src/modules/clubs/db-types.js';
import {
  ClubSeedError,
  formatClubSeedSummary,
  seedClubs,
  type ClubSeedEntry,
} from '../../src/modules/clubs/seed.js';
import { testDb } from '../helpers/db.js';

const FOUR: ClubSeedEntry[] = [
  { code: 'SODER', name: 'Soder', timezone: 'Europe/Stockholm' },
  { code: 'NORR', name: 'Norr', timezone: 'Europe/Stockholm' },
  { code: 'VAST', name: 'Vast', timezone: 'Europe/Stockholm' },
  { code: 'OST', name: 'Ost', timezone: 'Europe/Stockholm' },
];

describe('Club seed (US-117)', () => {
  const db = testDb() as unknown as Kysely<ClubDatabase>;

  beforeEach(async () => {
    await sql`TRUNCATE club CASCADE`.execute(db);
  });

  const allClubs = () => db.selectFrom('club').selectAll().orderBy('code').execute();

  it('AC 1: creates the clubs with code, name and time zone from the file', async () => {
    const lines: string[] = [];
    const result = await seedClubs(db, FOUR, (line) => lines.push(line));

    expect(result).toEqual({ inserted: 4, updated: 0, unchanged: 0, warnings: [] });
    expect(formatClubSeedSummary(result)).toBe('Clubs seeded: 4 inserted, 0 updated, 0 unchanged.');
    const rows = await allClubs();
    expect(rows.map(({ code, name, timezone }) => ({ code, name, timezone }))).toEqual(
      [...FOUR].sort((a, b) => a.code.localeCompare(b.code)),
    );
    expect(lines).toHaveLength(4);
  });

  it('AC 2: a re-run with the same file changes nothing and keeps the ids', async () => {
    await seedClubs(db, FOUR);
    const before = await allClubs();

    const result = await seedClubs(db, FOUR);

    expect(formatClubSeedSummary(result)).toBe('Clubs seeded: 0 inserted, 0 updated, 4 unchanged.');
    expect(await allClubs()).toEqual(before);
  });

  it('AC 2: a changed name or time zone updates the row in place', async () => {
    await seedClubs(db, FOUR);
    const before = await allClubs();
    const changed = FOUR.map((entry) =>
      entry.code === 'NORR' ? { ...entry, name: 'Norr Park', timezone: 'Europe/London' } : entry,
    );

    const result = await seedClubs(db, changed);

    expect(formatClubSeedSummary(result)).toBe('Clubs seeded: 0 inserted, 1 updated, 3 unchanged.');
    const after = await allClubs();
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    const norrBefore = before.find((row) => row.code === 'NORR');
    const norrAfter = after.find((row) => row.code === 'NORR');
    expect(norrAfter).toMatchObject({ name: 'Norr Park', timezone: 'Europe/London' });
    expect(norrAfter?.updated_at.getTime()).toBeGreaterThan(norrBefore?.updated_at.getTime() ?? Infinity);
    expect(norrAfter?.created_at).toEqual(norrBefore?.created_at);
    const others = after.filter((row) => row.code !== 'NORR');
    expect(others).toEqual(before.filter((row) => row.code !== 'NORR'));
  });

  it('AC 3: a name used by another club in the database writes nothing', async () => {
    await seedClubs(db, [FOUR[0] as ClubSeedEntry]);
    const before = await allClubs();

    const attempt = seedClubs(db, [
      { code: 'NEWCLUB', name: 'Brand New', timezone: 'UTC' },
      { code: 'CLASH', name: 'SODER', timezone: 'UTC' },
    ]);

    await expect(attempt).rejects.toBeInstanceOf(ClubSeedError);
    await expect(attempt).rejects.toThrow('Club name "SODER" is already used by club SODER.');
    expect(await allClubs()).toEqual(before);
  });

  it('AC 5: a club that is not in the file stays and is reported as a warning', async () => {
    await seedClubs(db, [...FOUR, { code: 'OLD-1', name: 'Old Club', timezone: 'UTC' }]);

    const result = await seedClubs(db, FOUR);

    expect(result.warnings).toEqual([
      'Warning: club OLD-1 exists in the database but not in the seed file; left unchanged.',
    ]);
    expect(result).toMatchObject({ inserted: 0, updated: 0, unchanged: 4 });
    const rows = await allClubs();
    expect(rows).toHaveLength(5);
    expect(rows.find((row) => row.code === 'OLD-1')).toMatchObject({ name: 'Old Club' });
  });

  it('AC 7: the database enforces the code format and unique names', async () => {
    await expect(
      db.insertInto('club').values({ code: 'lower', name: 'X', timezone: 'UTC' }).execute(),
    ).rejects.toThrow(/club_code_format_ck/);
    await seedClubs(db, [FOUR[0] as ClubSeedEntry]);
    await expect(
      db.insertInto('club').values({ code: 'OTHER', name: 'sODER', timezone: 'UTC' }).execute(),
    ).rejects.toThrow(/club_name_lower_uq/);
  });
});
