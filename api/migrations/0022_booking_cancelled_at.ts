import { sql, type Kysely } from 'kysely';

/**
 * When a booking was cancelled (US-124). Null while the booking is active. `IF NOT EXISTS` keeps this compatible
 * with a migration of US-122 that defines the same column.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE booking ADD COLUMN IF NOT EXISTS cancelled_at timestamptz`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE booking DROP COLUMN IF EXISTS cancelled_at`.execute(db);
}
