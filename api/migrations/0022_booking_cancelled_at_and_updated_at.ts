import { sql, type Kysely } from 'kysely';

/**
 * US-132: `booking.cancelled_at` (set when a declined payment cancels the booking) and `booking.updated_at`
 * (a replayed webhook must leave it untouched). US-122 declares the same columns; `IF NOT EXISTS` keeps the
 * two migrations compatible whichever runs first (same approach as 0006).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE booking ADD COLUMN IF NOT EXISTS cancelled_at timestamptz`.execute(db);
  await sql`ALTER TABLE booking ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`.execute(db);
}

/** No-op: the columns may hold data written by US-122 and US-124, which this rollback must not destroy. */
export async function down(): Promise<void> {}
