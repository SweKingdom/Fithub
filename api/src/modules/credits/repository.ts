import { sql, type Kysely } from 'kysely';
import type { CreditDatabase, CreditReason } from './db-types.js';

type Db = Kysely<CreditDatabase>;

export interface NewCreditTransaction {
  member_id: string;
  delta: number;
  reason: CreditReason;
  booking_id: string | null;
  balance_after: number;
  created_at: Date;
}

export interface CreditTransactionRow extends NewCreditTransaction {
  id: string;
}

const REFUND_REASONS: CreditReason[] = ['cancellation_refund', 'class_cancelled_refund'];

/** Current balance; a member without a balance row has 0. */
export async function getBalance(db: Db, memberId: string): Promise<number> {
  const row = await db.selectFrom('credit_balance').select('balance').where('member_id', '=', memberId).executeTakeFirst();
  return row?.balance ?? 0;
}

/** Like `getBalance`, but holds the row lock until the transaction ends. No row means nothing to lock and 0. */
export async function lockBalance(trx: Db, memberId: string): Promise<number> {
  const row = await trx
    .selectFrom('credit_balance')
    .select('balance')
    .where('member_id', '=', memberId)
    .forUpdate()
    .executeTakeFirst();
  return row?.balance ?? 0;
}

/**
 * Takes one credit. The `balance >= 1` condition is the concurrency guard: a second transaction on the same
 * member waits for the row lock and then re-checks against the committed value. Returns the new balance,
 * or `null` when there is no row or the balance is 0.
 */
export async function debitOne(trx: Db, memberId: string, now: Date): Promise<number | null> {
  const row = await trx
    .updateTable('credit_balance')
    .set({ balance: sql<number>`balance - 1`, updated_at: now })
    .where('member_id', '=', memberId)
    .where('balance', '>=', 1)
    .returning('balance')
    .executeTakeFirst();
  return row?.balance ?? null;
}

/** Adds one credit, creating the balance row when the member has none. Returns the new balance. */
export async function creditOne(trx: Db, memberId: string, now: Date): Promise<number> {
  const row = await trx
    .insertInto('credit_balance')
    .values({ member_id: memberId, balance: 1, updated_at: now })
    .onConflict((oc) =>
      oc.column('member_id').doUpdateSet({ balance: sql<number>`credit_balance.balance + 1`, updated_at: now }),
    )
    .returning('balance')
    .executeTakeFirstOrThrow();
  return row.balance;
}

export async function insertTransaction(trx: Db, row: NewCreditTransaction): Promise<CreditTransactionRow> {
  return trx.insertInto('credit_transaction').values(row).returningAll().executeTakeFirstOrThrow();
}

/** The debit and the return (if any) of one booking. */
export async function findBookingTransactions(
  trx: Db,
  bookingId: string,
): Promise<{ debit: CreditTransactionRow | null; refund: CreditTransactionRow | null }> {
  const rows = await trx.selectFrom('credit_transaction').selectAll().where('booking_id', '=', bookingId).execute();
  return {
    debit: rows.find((row) => row.reason === 'booking') ?? null,
    refund: rows.find((row) => REFUND_REASONS.includes(row.reason)) ?? null,
  };
}
