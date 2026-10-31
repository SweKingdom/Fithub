import { sql, type Kysely } from 'kysely';

/**
 * Attendance on bookings (US-129).
 *
 * `attendance` is part of the booking shape (US-122); `IF NOT EXISTS` keeps this migration safe when
 * that column is already there. The audit columns are new: who recorded the attendance (null together
 * with a timestamp = set by the auto no-show sweep) and when.
 *
 * Existing rows are all `unknown` with no timestamp, so the new CHECK holds for them.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE booking ADD COLUMN IF NOT EXISTS attendance text NOT NULL DEFAULT 'unknown'`.execute(db);
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_attendance_ck') THEN
        ALTER TABLE booking
          ADD CONSTRAINT booking_attendance_ck CHECK (attendance IN ('unknown', 'attended', 'no_show'));
      END IF;
    END
    $$
  `.execute(db);
  await sql`
    ALTER TABLE booking
      ADD COLUMN attendance_recorded_by uuid REFERENCES app_user (id) ON DELETE RESTRICT,
      ADD COLUMN attendance_recorded_at timestamptz
  `.execute(db);
  await sql`
    ALTER TABLE booking
      ADD CONSTRAINT booking_attendance_recorded_ck CHECK ((attendance = 'unknown') = (attendance_recorded_at IS NULL))
  `.execute(db);
}

/** Recorded attendance (who and when) is lost: acceptable only before go-live. The `attendance` column stays. */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE booking DROP CONSTRAINT IF EXISTS booking_attendance_recorded_ck`.execute(db);
  await sql`
    ALTER TABLE booking
      DROP COLUMN IF EXISTS attendance_recorded_at,
      DROP COLUMN IF EXISTS attendance_recorded_by
  `.execute(db);
}
