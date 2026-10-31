import { sql, type Kysely } from 'kysely';
import { expect } from 'vitest';
import type { CreditDatabase } from '../../src/modules/credits/db-types.js';

/** Gives a member `n` credits: the balance row plus a matching `manual_adjustment` ledger row (none when n = 0). */
export async function setCredits(db: Kysely<CreditDatabase>, memberId: string, n: number): Promise<void> {
  await db.insertInto('credit_balance').values({ member_id: memberId, balance: n, updated_at: new Date() }).execute();
  if (n > 0) {
    await db
      .insertInto('credit_transaction')
      .values({
        member_id: memberId,
        delta: n,
        reason: 'manual_adjustment',
        booking_id: null,
        balance_after: n,
      })
      .execute();
  }
}

/** Reconciliation query: every balance equals the sum of the member's ledger deltas. Expects no rows. */
export async function expectLedgerConsistent(db: Kysely<CreditDatabase>): Promise<void> {
  const result = await sql<{ member_id: string; balance: number; ledger_sum: number }>`
    SELECT b.member_id, b.balance, COALESCE(SUM(t.delta), 0)::int AS ledger_sum
    FROM credit_balance b LEFT JOIN credit_transaction t ON t.member_id = b.member_id
    GROUP BY b.member_id, b.balance
    HAVING b.balance <> COALESCE(SUM(t.delta), 0)`.execute(db);
  expect(result.rows).toEqual([]);
}
