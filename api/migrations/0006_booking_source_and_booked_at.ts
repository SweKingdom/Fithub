import { sql, type Kysely } from 'kysely';

/**
 * Columns that waiting-list promotion writes on a booking (US-128): where the booking came from and when it was
 * made. US-122 defines the same columns for direct bookings; `IF NOT EXISTS` keeps the two migrations compatible.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE booking ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'direct'`.execute(db);
  await sql`ALTER TABLE booking ADD COLUMN IF NOT EXISTS booked_at timestamptz NOT NULL DEFAULT now()`.execute(db);
  await sql`ALTER TABLE booking DROP CONSTRAINT IF EXISTS booking_source_ck`.execute(db);
  await sql`ALTER TABLE booking ADD CONSTRAINT booking_source_ck CHECK (source IN ('direct', 'waitlist'))`.execute(db);
  await db.schema
    .createIndex('booking_class_status_idx')
    .ifNotExists()
    .on('booking')
    .columns(['class_id', 'status'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('booking_class_status_idx').ifExists().execute();
  await sql`ALTER TABLE booking DROP CONSTRAINT IF EXISTS booking_source_ck`.execute(db);
  await sql`ALTER TABLE booking DROP COLUMN IF EXISTS booked_at`.execute(db);
  await sql`ALTER TABLE booking DROP COLUMN IF EXISTS source`.execute(db);
}
