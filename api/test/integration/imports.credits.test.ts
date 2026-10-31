import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importCredits } from '../../src/modules/imports/credits.js';
import { writeCreditReport } from '../../src/modules/imports/credits.report.js';
import { ImportFileError } from '../../src/modules/imports/errors.js';
import { testDb } from '../helpers/db.js';
import { createUser, expectLedgerConsistent } from '../helpers/factories.js';

// Lets one test hide the existing migration rows from the plan, to provoke a database error
// (credit_transaction_migration_uq) after the balance was already written in the same transaction.
const hide = vi.hoisted(() => ({ migrationRows: false }));
vi.mock('../../src/modules/imports/credits.repository.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/modules/imports/credits.repository.js')>();
  return {
    ...original,
    loadCreditSnapshot: async (...args: Parameters<typeof original.loadCreditSnapshot>) => {
      const snapshot = await original.loadCreditSnapshot(...args);
      if (hide.migrationRows) snapshot.migrated.clear();
      return snapshot;
    },
  };
});

const NOW = new Date('2026-10-30T09:00:00.000Z');
const clock = { now: () => NOW };
const dir = mkdtempSync(join(tmpdir(), 'import-credits-'));
let fileCount = 0;

function csv(header: string, rows: string[]): string {
  fileCount += 1;
  const path = join(dir, `credits-${fileCount}.csv`);
  writeFileSync(path, [header, ...rows].join('\n'));
  return path;
}

describe('credit import (US-136)', () => {
  const db = testDb();

  beforeEach(async () => {
    hide.migrationRows = false;
    await db.deleteFrom('credit_transaction').execute();
    await db.deleteFrom('credit_balance').execute();
    await db.deleteFrom('import_member_alias').execute();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (file: string, dryRun = false) => importCredits(db, { file, delimiter: ',', dryRun, clock });
  const counts = async () => ({
    balances: Number((await db.selectFrom('credit_balance').select(db.fn.countAll().as('n')).executeTakeFirstOrThrow()).n),
    ledger: Number((await db.selectFrom('credit_transaction').select(db.fn.countAll().as('n')).executeTakeFirstOrThrow()).n),
  });
  async function member(email: string, legacyNumber?: string, memberType: 'regular' | 'drop_in' = 'regular') {
    const user = await createUser(db, { role: 'member', memberType, email });
    if (legacyNumber) {
      await db.insertInto('import_member_alias').values({ legacy_member_id: legacyNumber, user_id: user.id }).execute();
    }
    return user;
  }
  const balanceOf = async (memberId: string) =>
    (await db.selectFrom('credit_balance').select('balance').where('member_id', '=', memberId).executeTakeFirst())?.balance;

  it('AC 1: loads a balance by legacy number and by email in one ledger row each', async () => {
    const byNumber = await member('a@x.se', 'L1');
    const byEmail = await member('b@x.se');
    const result = await run(csv('legacy_member_number,email,credits', ['L1,,8', ',B@x.se ,3']));

    expect(result).toMatchObject({ loaded: 2, creditsLoaded: 11, balanced: true });
    expect(await balanceOf(byNumber.id)).toBe(8);
    expect(await balanceOf(byEmail.id)).toBe(3);
    const ledger = await db.selectFrom('credit_transaction').selectAll().where('member_id', '=', byNumber.id).execute();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: 8, reason: 'migration', booking_id: null, balance_after: 8 });
    await expectLedgerConsistent(db);
  });

  it('AC 1: adds to an existing balance and records the new balance in balance_after', async () => {
    const user = await member('a@x.se');
    await db.insertInto('credit_balance').values({ member_id: user.id, balance: 2, updated_at: NOW }).execute();
    await run(csv('email,credits', ['a@x.se,8']));
    expect(await balanceOf(user.id)).toBe(10);
    const ledger = await db.selectFrom('credit_transaction').select('balance_after').where('member_id', '=', user.id).execute();
    expect(ledger).toEqual([{ balance_after: 10 }]);
  });

  it('AC 2: the report summary balances and is written without personal data', async () => {
    await member('a@x.se');
    const result = await run(csv('email,credits', ['a@x.se,4', 'nobody@x.se,6', 'a@x.se,abc']));
    const out = join(dir, 'report-ac2');
    writeCreditReport(out, result);
    const summary = JSON.parse(readFileSync(join(out, 'import-summary.json'), 'utf8'));
    expect(summary).toMatchObject({
      kind: 'credits',
      dryRun: false,
      sourceRows: 3,
      loaded: 1,
      rejected: 2,
      sourceCredits: 10,
      creditsLoaded: 4,
      creditsRejected: 6,
      balanced: true,
    });
    expect(summary.sourceCredits).toBe(summary.creditsLoaded + summary.creditsUnchanged + summary.creditsRejected);
    expect(JSON.stringify(summary)).not.toContain('a@x.se');
  });

  it('AC 3: a second run of the same file changes nothing', async () => {
    await member('a@x.se', 'L1');
    const file = csv('legacy_member_number,credits', ['L1,8']);
    await run(file);
    const before = await counts();
    const second = await run(file);
    expect(second).toMatchObject({ loaded: 0, unchanged: 1, creditsLoaded: 0, creditsUnchanged: 8, balanced: true });
    expect(await counts()).toEqual(before);
    await expectLedgerConsistent(db);
  });

  it('AC 3: a different total for a migrated member is rejected and nothing changes', async () => {
    const user = await member('a@x.se');
    await run(csv('email,credits', ['a@x.se,8']));
    const before = await counts();
    const result = await run(csv('email,credits', ['a@x.se,9']));
    expect(result.rejections[0]).toMatchObject({ reason: 'ALREADY_MIGRATED_DIFFERENT_TOTAL', line: 2 });
    expect(result.loaded).toBe(0);
    expect(await counts()).toEqual(before);
    expect(await balanceOf(user.id)).toBe(8);
  });

  it('AC 4: an unknown number or email is rejected with its line and nothing is written for it', async () => {
    const result = await run(csv('legacy_member_number,email,credits', ['NOPE,,1', ',x@x.se,2']));
    expect(result.rejections.map((r) => [r.line, r.reason])).toEqual([
      [2, 'MEMBER_NOT_FOUND'],
      [3, 'MEMBER_NOT_FOUND'],
    ]);
    expect(await counts()).toEqual({ balances: 0, ledger: 0 });
  });

  it('AC 5: rows of two aliases of one member are summed into one ledger row and listed as merged', async () => {
    const user = await member('a@x.se', 'L1');
    await db.insertInto('import_member_alias').values({ legacy_member_id: 'L2', user_id: user.id }).execute();
    const result = await run(csv('legacy_member_number,credits', ['L1,3', 'L2,2']));
    const ledger = await db.selectFrom('credit_transaction').select(['delta', 'balance_after']).where('member_id', '=', user.id).execute();
    expect(ledger).toEqual([{ delta: 5, balance_after: 5 }]);
    expect(result).toMatchObject({ loaded: 1, merged: 1 });
    expect(result.merges).toEqual([{ line: 3, mergedIntoLine: 2, legacyNumber: 'L2', email: '', credits: 2 }]);
    const out = join(dir, 'report-ac5');
    writeCreditReport(out, result);
    expect(readFileSync(join(out, 'import-merges.csv'), 'utf8')).toContain('3,2,L2');
  });

  it('AC 6: invalid values, missing reference, drop-in, staff and ambiguous rows are rejected; valid rows of the same member load', async () => {
    const regular = await member('a@x.se', 'L1');
    await member('b@x.se', 'L2');
    await member('d@x.se', 'LD', 'drop_in');
    await createUser(db, { role: 'instructor', email: 's@x.se' });
    const result = await run(
      csv('legacy_member_number,email,credits', [
        ',a@x.se,-1',
        ',a@x.se,2.5',
        ',a@x.se,',
        ',a@x.se,abc',
        ',,4',
        'LD,,1',
        ',s@x.se,1',
        'L1,b@x.se,1',
        ',a@x.se,5',
      ]),
    );
    expect(result.rejectedByReason).toEqual({
      INVALID_CREDITS: 4,
      MISSING_MEMBER_REFERENCE: 1,
      MEMBER_NOT_CREDIT_USER: 2,
      AMBIGUOUS_MEMBER: 1,
    });
    expect(result).toMatchObject({ loaded: 1, balanced: true });
    expect(await balanceOf(regular.id)).toBe(5);
    expect(await counts()).toEqual({ balances: 1, ledger: 1 });
  });

  it('AC 7: zero credits write no ledger row and no balance row', async () => {
    await member('a@x.se');
    const result = await run(csv('email,credits', ['a@x.se,0']));
    expect(result).toMatchObject({ zero: 1, loaded: 0, balanced: true });
    expect(await counts()).toEqual({ balances: 0, ledger: 0 });
  });

  it('AC 8: a dry run returns the same summary as a real run and writes nothing', async () => {
    await member('a@x.se');
    const file = csv('email,credits', ['a@x.se,8', 'nobody@x.se,1']);
    const dry = await run(file, true);
    expect(await counts()).toEqual({ balances: 0, ledger: 0 });
    const real = await run(file);
    expect(dry).toMatchObject({ dryRun: true, loaded: 1, rejected: 1, creditsLoaded: 8, balanced: true });
    expect(real).toMatchObject({ dryRun: false, loaded: dry.loaded, rejected: dry.rejected, creditsLoaded: dry.creditsLoaded });
  });

  describe('AC 9: invalid input writes nothing', () => {
    it('a missing file', async () => {
      await expect(run(join(dir, 'does-not-exist.csv'))).rejects.toBeInstanceOf(ImportFileError);
    });

    it('a missing credits column', async () => {
      await expect(run(csv('email', ['a@x.se']))).rejects.toThrow(/Missing column\(s\): credits/);
    });

    it('neither member column', async () => {
      await expect(run(csv('credits', ['3']))).rejects.toThrow('Missing column(s): legacy_member_number or email.');
    });

    it('a duplicate column', async () => {
      await expect(run(csv('email,credits,credits', ['a@x.se,1,2']))).rejects.toBeInstanceOf(ImportFileError);
    });

    it('no data rows', async () => {
      await expect(run(csv('email,credits', []))).rejects.toBeInstanceOf(ImportFileError);
    });

    it('a database error during the write rolls everything back', async () => {
      const user = await member('a@x.se');
      await run(csv('email,credits', ['a@x.se,8']));
      hide.migrationRows = true;
      await expect(run(csv('email,credits', ['a@x.se,9']))).rejects.toThrow();
      expect(await balanceOf(user.id)).toBe(8);
      expect(await counts()).toEqual({ balances: 1, ledger: 1 });
    });
  });

  it('AC 10: the ledger reconciliation finds no difference after a run with merges', async () => {
    const user = await member('a@x.se', 'L1');
    await member('b@x.se');
    await db.insertInto('import_member_alias').values({ legacy_member_id: 'L2', user_id: user.id }).execute();
    await run(csv('legacy_member_number,email,credits', ['L1,,3', 'L2,,2', ',b@x.se,6']));
    await expectLedgerConsistent(db);
  });
});
