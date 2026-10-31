import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ImportDatabase } from '../../src/modules/imports/db-types.js';
import { ImportFileError } from '../../src/modules/imports/errors.js';
import { importMembers, type ImportMembersOptions } from '../../src/modules/imports/members.js';
import { planMemberImport } from '../../src/modules/imports/members.plan.js';
import { formatSummaryLine, writeImportReport } from '../../src/modules/imports/report.js';
import { testDb } from '../helpers/db.js';
import { writeImportCsv } from '../helpers/import-csv.js';

const HEADER = ['email', 'full_name', 'member_type', 'legacy_member_number', 'home_club_code'];
const DOMAIN = '@import.test';
const NOW = new Date('2026-10-30T09:00:00.000Z');
const clock = { now: () => NOW };

describe('Member import (US-135)', () => {
  const db = testDb() as unknown as Kysely<ImportDatabase>;
  let dir: string;
  let typeMapPath: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'import-members-'));
    typeMapPath = join(dir, 'member-type-map.json');
    writeFileSync(typeMapPath, JSON.stringify({ regular: 'regular', drop_in: 'drop_in', 'drop-in': 'drop_in' }));
    await sql`INSERT INTO club (code, name, timezone) VALUES ('IMP-A', 'Import Club A', 'Europe/Stockholm')
      ON CONFLICT (code) DO NOTHING`.execute(db);
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await sql`DELETE FROM import_member_alias WHERE user_id IN (SELECT id FROM app_user WHERE email LIKE ${'%' + DOMAIN})`.execute(db);
    await sql`DELETE FROM app_user WHERE email LIKE ${'%' + DOMAIN}`.execute(db);
  });

  async function run(rows: string[][], options: Partial<ImportMembersOptions> = {}) {
    const file = writeImportCsv(dir, HEADER, rows);
    return importMembers(db, { file, typeMapPath, delimiter: ',', dryRun: false, clock, ...options });
  }

  async function count(table: 'app_user' | 'import_member_alias'): Promise<number> {
    const result =
      table === 'app_user'
        ? await sql<{ n: number }>`SELECT count(*)::int AS n FROM app_user WHERE email LIKE ${'%' + DOMAIN}`.execute(db)
        : await sql<{ n: number }>`SELECT count(*)::int AS n FROM import_member_alias
            WHERE user_id IN (SELECT id FROM app_user WHERE email LIKE ${'%' + DOMAIN})`.execute(db);
    return result.rows[0].n;
  }

  async function userByEmail(email: string) {
    return db.selectFrom('app_user').selectAll().where('email', '=', email).executeTakeFirst();
  }

  it('AC 1: loads 1,000 valid rows as members without a password', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => [
      `User${i}${DOMAIN}`,
      `Member  ${i}`,
      'regular',
      `L${i}`,
      'imp-a',
    ]);
    const result = await run(rows);
    expect(result.plan.inserted).toBe(1000);
    expect(await count('app_user')).toBe(1000);
    expect(await count('import_member_alias')).toBe(1000);

    const user = await userByEmail(`user7${DOMAIN}`);
    expect(user).toMatchObject({
      role: 'member',
      password_hash: null,
      full_name: 'Member 7',
      member_type: 'regular',
      legacy_member_id: 'L7',
    });
    const club = await db.selectFrom('club').select('id').where('code', '=', 'IMP-A').executeTakeFirstOrThrow();
    expect(user?.club_id).toBe(club.id);
  });

  it('AC 2: merges duplicates into one member with an alias per number', async () => {
    const result = await run([
      [`Anna${DOMAIN}`, 'Anna Lind', 'regular', 'L1', 'IMP-A'],
      [` anna${DOMAIN} `, 'Anna Lind', 'regular', 'L2', 'IMP-A'],
    ]);
    expect(result.plan.merged).toBe(1);
    expect(await count('app_user')).toBe(1);
    const user = await userByEmail(`anna${DOMAIN}`);
    expect(user?.legacy_member_id).toBe('L1');
    const aliases = await db
      .selectFrom('import_member_alias')
      .select(['legacy_member_id', 'user_id'])
      .where('user_id', '=', user!.id)
      .orderBy('legacy_member_id')
      .execute();
    expect(aliases.map((a) => a.legacy_member_id)).toEqual(['L1', 'L2']);

    const outDir = join(dir, 'out-merge');
    writeImportReport(outDir, result);
    expect(readFileSync(join(outDir, 'import-merges.csv'), 'utf8')).toBe(
      `line,merged_into_line,email,legacy_member_number\n3,2,anna${DOMAIN},L2\n`,
    );
  });

  it('AC 3: conflicting duplicates are rejected and an existing member stays unchanged', async () => {
    await run([[`carl${DOMAIN}`, 'Carl Berg', 'regular', '', '']]);
    const before = await userByEmail(`carl${DOMAIN}`);
    const result = await run([
      [`carl${DOMAIN}`, 'Carl Berg', 'regular', '', ''],
      [`carl${DOMAIN}`, 'Carl Bergman', 'regular', '', ''],
    ]);
    expect(result.plan.rejections.map((r) => [r.line, r.reason])).toEqual([
      [2, 'CONFLICTING_DUPLICATE'],
      [3, 'CONFLICTING_DUPLICATE'],
    ]);
    expect(result.plan.rejections[0].message).toContain('full name');
    expect(await userByEmail(`carl${DOMAIN}`)).toEqual(before);

    await run([[`dora${DOMAIN}`, 'Dora', 'regular', '', ''], [`dora${DOMAIN}`, 'Dora', 'drop_in', '', '']]);
    expect(await userByEmail(`dora${DOMAIN}`)).toBeUndefined();
  });

  it('AC 4: a re-run changes nothing and a corrected name updates the same member', async () => {
    const rows = [
      [`a${DOMAIN}`, 'Anna', 'regular', 'L1', 'IMP-A'],
      [`a${DOMAIN}`, 'Anna', 'regular', 'L2', 'IMP-A'],
      [`b${DOMAIN}`, 'Bo', 'drop-in', '', ''],
      ['bad', 'Bad', 'regular', '', ''],
    ];
    const first = await run(rows);
    expect([first.plan.inserted, first.plan.merged, first.plan.rejected]).toEqual([2, 1, 1]);
    const users = await count('app_user');
    const aliases = await count('import_member_alias');

    const second = await run(rows);
    expect([second.plan.inserted, second.plan.updated, second.plan.unchanged]).toEqual([0, 0, 2]);
    expect([second.plan.merged, second.plan.rejected]).toEqual([1, 1]);
    expect(await count('app_user')).toBe(users);
    expect(await count('import_member_alias')).toBe(aliases);

    const idBefore = (await userByEmail(`b${DOMAIN}`))!.id;
    const third = await run([
      rows[0],
      rows[1],
      [`b${DOMAIN}`, 'Bo Corrected', 'drop-in', '', ''],
      rows[3],
    ]);
    expect([third.plan.updated, third.plan.inserted]).toEqual([1, 0]);
    const after = await userByEmail(`b${DOMAIN}`);
    expect(after?.id).toBe(idBefore);
    expect(after?.full_name).toBe('Bo Corrected');
  });

  it('AC 5: rejections are reported with line, reason and message and nothing is loaded', async () => {
    const result = await run([
      ['bad-email', 'Anna', 'regular', '', ''],
      [`b${DOMAIN}`, '', 'regular', '', ''],
      [`c${DOMAIN}`, 'Cia', 'gold', '', ''],
      [`d${DOMAIN}`, 'Dan', 'regular', '', 'NOPE'],
      [`e${DOMAIN}`, 'Eva', 'regular', 'L9', ''],
      [`f${DOMAIN}`, 'Fia', 'regular', 'L9', ''],
    ]);
    expect(result.plan.rejections.map((r) => [r.line, r.reason])).toEqual([
      [2, 'INVALID_EMAIL'],
      [3, 'INVALID_NAME'],
      [4, 'UNMAPPED_MEMBER_TYPE'],
      [5, 'UNKNOWN_CLUB'],
      [6, 'LEGACY_NUMBER_REUSED'],
      [7, 'LEGACY_NUMBER_REUSED'],
    ]);
    expect(await count('app_user')).toBe(0);

    const outDir = join(dir, 'out-reject');
    writeImportReport(outDir, result);
    const csv = readFileSync(join(outDir, 'import-rejections.csv'), 'utf8').split('\n');
    expect(csv[0]).toBe('line,reason,message,email,legacy_member_number');
    expect(csv[1]).toBe('2,INVALID_EMAIL,Email is missing or invalid.,bad-email,');
    expect(csv).toHaveLength(8);
  });

  it('AC 6: an email of a staff account is rejected and the staff row is unchanged', async () => {
    await sql`INSERT INTO app_user (email, full_name, role, club_id)
      SELECT ${'staff' + DOMAIN}, 'Staff Person', 'instructor', id FROM club WHERE code = 'IMP-A'`.execute(db);
    const before = await userByEmail(`staff${DOMAIN}`);
    const result = await run([[`Staff${DOMAIN}`, 'Someone Else', 'regular', 'L5', '']]);
    expect(result.plan.rejections).toMatchObject([{ line: 2, reason: 'EMAIL_USED_BY_STAFF' }]);
    expect(await userByEmail(`staff${DOMAIN}`)).toEqual(before);
    expect(await count('import_member_alias')).toBe(0);
  });

  it('AC 7: the summary balances and an unbalanced plan writes nothing', async () => {
    const result = await run([
      [`a${DOMAIN}`, 'Anna', 'regular', '', ''],
      [`a${DOMAIN}`, 'Anna', 'regular', '', ''],
      ['bad', 'Bad', 'regular', '', ''],
    ]);
    const outDir = join(dir, 'out-summary');
    writeImportReport(outDir, result);
    const summary = JSON.parse(readFileSync(join(outDir, 'import-summary.json'), 'utf8'));
    expect(summary.sourceRows).toBe(3);
    expect(summary.inserted + summary.updated + summary.unchanged + summary.merged + summary.rejected).toBe(3);
    expect(summary).toMatchObject({ kind: 'members', balanced: true, dryRun: false, rejectedByReason: { INVALID_EMAIL: 1 } });
    expect(formatSummaryLine(result, outDir)).toBe(
      `Members import: 3 rows → 1 inserted, 0 updated, 0 unchanged, 1 merged, 1 rejected. Reports: ${outDir}`,
    );

    await expect(
      run([[`z${DOMAIN}`, 'Zed', 'regular', '', '']], {
        planner: (rows, ctx, snapshot) => ({ ...planMemberImport(rows, ctx, snapshot), balanced: false }),
      }),
    ).rejects.toThrow(ImportFileError);
    expect(await userByEmail(`z${DOMAIN}`)).toBeUndefined();
  });

  it('AC 8: a dry run gives the same reports and writes nothing', async () => {
    const rows = [
      [`a${DOMAIN}`, 'Anna', 'regular', 'L1', ''],
      [`a${DOMAIN}`, 'Anna', 'regular', 'L2', ''],
      ['bad', 'Bad', 'regular', '', ''],
    ];
    const result = await run(rows, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect([result.plan.inserted, result.plan.merged, result.plan.rejected]).toEqual([1, 1, 1]);
    expect(await count('app_user')).toBe(0);
    expect(await count('import_member_alias')).toBe(0);

    const outDir = join(dir, 'out-dry');
    writeImportReport(outDir, result);
    expect(JSON.parse(readFileSync(join(outDir, 'import-summary.json'), 'utf8')).dryRun).toBe(true);
    expect(existsSync(join(outDir, 'import-rejections.csv'))).toBe(true);
    expect(existsSync(join(outDir, 'import-merges.csv'))).toBe(true);
    expect(formatSummaryLine(result, outDir)).toContain('Members import (dry run): 3 rows');
  });

  describe('AC 9: invalid input leaves the database unchanged', () => {
    it('rejects a missing file, a missing column, a duplicate column and no data rows', async () => {
      const options = { typeMapPath, delimiter: ',', dryRun: false, clock };
      await expect(importMembers(db, { ...options, file: join(dir, 'nope.csv') })).rejects.toThrow(/Import file not found/);

      const noEmail = join(dir, 'no-email.csv');
      writeFileSync(noEmail, 'full_name,member_type\nAnna,regular\n');
      await expect(importMembers(db, { ...options, file: noEmail })).rejects.toThrow('Missing column(s): email.');

      const dup = join(dir, 'dup.csv');
      writeFileSync(dup, 'email,email,full_name,member_type\na,b,c,d\n');
      await expect(importMembers(db, { ...options, file: dup })).rejects.toThrow('Duplicate column(s): email.');

      const empty = join(dir, 'empty.csv');
      writeFileSync(empty, 'email,full_name,member_type\n');
      await expect(importMembers(db, { ...options, file: empty })).rejects.toThrow('The import file has no data rows.');
      expect(await count('app_user')).toBe(0);
    });

    it('rejects a missing or invalid mapping file', async () => {
      const file = writeImportCsv(dir, HEADER, [[`a${DOMAIN}`, 'Anna', 'regular', '', '']]);
      const options = { file, delimiter: ',', dryRun: false, clock };
      await expect(importMembers(db, { ...options, typeMapPath: join(dir, 'missing.json') })).rejects.toThrow(
        /Member type map not found/,
      );
      const bad = join(dir, 'bad-map.json');
      writeFileSync(bad, '{"regular":"premium"}');
      await expect(importMembers(db, { ...options, typeMapPath: bad })).rejects.toThrow(/must be "regular" or "drop_in"/);
      expect(await count('app_user')).toBe(0);
    });

    it('rolls everything back when the database rejects the write', async () => {
      await expect(
        run(
          [
            [`a${DOMAIN}`, 'Anna', 'regular', 'L1', ''],
            [`b${DOMAIN}`, 'Bo', 'regular', 'L2', ''],
          ],
          {
            planner: (rows, ctx, snapshot) => {
              const plan = planMemberImport(rows, ctx, snapshot);
              // A second insert of the same email breaks the unique email index (as a sign-up race would).
              plan.inserts.push({ ...plan.inserts[0], aliases: [] });
              return plan;
            },
          },
        ),
      ).rejects.not.toBeInstanceOf(ImportFileError);
      expect(await count('app_user')).toBe(0);
      expect(await count('import_member_alias')).toBe(0);
    });
  });
});
