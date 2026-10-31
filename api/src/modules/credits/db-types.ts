import type { ColumnType, Generated } from 'kysely';

export type CreditReason =
  | 'migration'
  | 'booking'
  | 'cancellation_refund'
  | 'class_cancelled_refund'
  | 'manual_adjustment';

/** `credit_balance`: one row per member that ever had credits; a missing row means a balance of 0 (US-125). */
export interface CreditBalanceTable {
  member_id: string;
  balance: number;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

/** `credit_transaction`: append-only ledger. The code never updates or deletes rows. */
export interface CreditTransactionTable {
  id: Generated<string>;
  member_id: string;
  delta: number;
  reason: CreditReason;
  booking_id: string | null;
  balance_after: number;
  created_at: ColumnType<Date, Date | undefined, never>;
}

/** The tables the credits module touches. Merge into `db/schema.ts` (`Database`) when both exist. */
export interface CreditDatabase {
  credit_balance: CreditBalanceTable;
  credit_transaction: CreditTransactionTable;
}
