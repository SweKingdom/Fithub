import { sql, type Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CreditDatabase } from '../../src/modules/credits/db-types.js';
import { creditOne, debitOne, getBalance, insertTransaction } from '../../src/modules/credits/repository.js';
import { testDb } from '../helpers/db.js';
import { expectLedgerConsistent, setCredits } from '../helpers/credits.js';

const DOMAIN = '@credits.test';
const NOW = new Date('2026-10-30T09:00:00.000Z');

describe('Credit balance and ledger (US-125)', () => {
  const db = testDb() as unknown as Kysely<CreditDatabase>;

  async function clean(): Promise<void> {
    const members = sql`SELECT id FROM app_user WHERE email LIKE ${'%' + DOMAIN}`;
    await sql`DELETE FROM credit_transaction WHERE member_id IN (${members})`.execute(db);
    await sql`DELETE FROM credit_balance WHERE member_id IN (${members})`.execute(db);
    await sql`DELETE FROM app_user WHERE email LIKE ${'%' + DOMAIN}`.execute(db);
  }

  async function newMember(name: string): Promise<string> {
    const result = await sql<{ id: string }>`
      INSERT INTO app_user (email, full_name, role, member_type)
      VALUES (${name + DOMAIN}, ${name}, 'member', 'regular') RETURNING id`.execute(db);
    return result.rows[0].id;
  }

  beforeEach(clean);
  afterEach(async () => {
    await expectLedgerConsistent(db);
    await clean();
  });

  it('AC 4: debitOne takes one credit and returns the new balance', async () => {
    const member = await newMember('debit');
    await setCredits(db, member, 5);
    expect(await debitOne(db, member, NOW)).toBe(4);
    expect(await getBalance(db, member)).toBe(4);
  });

  it('AC 2: debitOne returns null for a member with 0 credits or no balance row', async () => {
    const empty = await newMember('empty');
    const noRow = await newMember('norow');
    await setCredits(db, empty, 0);
    expect(await debitOne(db, empty, NOW)).toBeNull();
    expect(await debitOne(db, noRow, NOW)).toBeNull();
    expect(await getBalance(db, empty)).toBe(0);
    expect(await getBalance(db, noRow)).toBe(0);
  });

  it('AC 4: two parallel debits on 1 credit succeed once; the balance ends at 0', async () => {
    const member = await newMember('parallel');
    await setCredits(db, member, 1);
    const results = await Promise.all([
      db.transaction().execute((trx) => debitOne(trx, member, NOW)),
      db.transaction().execute((trx) => debitOne(trx, member, NOW)),
    ]);
    expect(results.filter((balance) => balance === 0)).toHaveLength(1);
    expect(results.filter((balance) => balance === null)).toHaveLength(1);
    expect(await getBalance(db, member)).toBe(0);
  });

  it('AC 4: setting the balance to -1 fails with credit_balance_non_negative_ck', async () => {
    const member = await newMember('negative');
    await setCredits(db, member, 1);
    const attempt = sql`UPDATE credit_balance SET balance = -1 WHERE member_id = ${member}`.execute(db);
    await expect(attempt).rejects.toMatchObject({ code: '23514', constraint: 'credit_balance_non_negative_ck' });
  });

  it('creditOne creates the balance row when missing and adds 1 to an existing one', async () => {
    const member = await newMember('credit');
    expect(await creditOne(db, member, NOW)).toBe(1);
    expect(await creditOne(db, member, NOW)).toBe(2);
    await insertTransaction(db, {
      member_id: member,
      delta: 2,
      reason: 'migration',
      booking_id: null,
      balance_after: 2,
      created_at: NOW,
    });
    expect(await getBalance(db, member)).toBe(2);
  });

  it('AC 11: the reconciliation query reports a balance that differs from the ledger', async () => {
    const member = await newMember('mismatch');
    await setCredits(db, member, 2);
    await sql`UPDATE credit_balance SET balance = 3 WHERE member_id = ${member}`.execute(db);
    await expect(expectLedgerConsistent(db)).rejects.toThrow();
    await sql`UPDATE credit_balance SET balance = 2 WHERE member_id = ${member}`.execute(db);
  });

  describe('ledger constraints', () => {
    const row = (member: string, overrides: Partial<Parameters<typeof insertTransaction>[1]> = {}) => ({
      member_id: member,
      delta: 1,
      reason: 'manual_adjustment' as const,
      booking_id: null,
      balance_after: 1,
      created_at: NOW,
      ...overrides,
    });

    it('rejects a delta that does not fit the reason', async () => {
      const member = await newMember('delta');
      await expect(insertTransaction(db, row(member, { reason: 'migration', delta: -1 }))).rejects.toMatchObject({
        constraint: 'credit_transaction_delta_ck',
      });
      await expect(insertTransaction(db, row(member, { delta: 0 }))).rejects.toMatchObject({
        constraint: 'credit_transaction_delta_ck',
      });
    });

    it('rejects a booking reason without a booking and an unknown reason', async () => {
      const member = await newMember('reason');
      await expect(
        insertTransaction(db, row(member, { reason: 'booking', delta: -1, balance_after: 0 })),
      ).rejects.toMatchObject({ constraint: 'credit_transaction_booking_ck' });
      await expect(
        insertTransaction(db, row(member, { reason: 'bonus' as 'migration' })),
      ).rejects.toMatchObject({ constraint: 'credit_transaction_reason_ck' });
    });

    it('rejects a negative balance_after', async () => {
      const member = await newMember('after');
      await expect(insertTransaction(db, row(member, { balance_after: -1 }))).rejects.toMatchObject({
        constraint: 'credit_transaction_balance_after_ck',
      });
    });

    it('allows only one migration row per member', async () => {
      const member = await newMember('migration');
      await creditOne(db, member, NOW);
      await insertTransaction(db, row(member, { reason: 'migration' }));
      await expect(insertTransaction(db, row(member, { reason: 'migration' }))).rejects.toMatchObject({
        constraint: 'credit_transaction_migration_uq',
      });
    });
  });
});
