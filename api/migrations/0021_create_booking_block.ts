import { sql, type Kysely } from 'kysely';

/**
 * No-show blocks (US-130): table `booking_block`, `booking.no_show_block_id` and the partial index that counts
 * uncounted no-shows. The no-show count reads `booking.attendance`, which US-129 owns; `IF NOT EXISTS` keeps the
 * two migrations compatible whichever runs first (same approach as 0006).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE booking ADD COLUMN IF NOT EXISTS attendance text NOT NULL DEFAULT 'unknown'`.execute(db);
  await sql`ALTER TABLE booking DROP CONSTRAINT IF EXISTS booking_attendance_ck`.execute(db);
  await sql`ALTER TABLE booking ADD CONSTRAINT booking_attendance_ck CHECK (attendance IN ('unknown', 'attended', 'no_show'))`.execute(
    db,
  );

  await db.schema
    .createTable('booking_block')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('member_id', 'uuid', (col) => col.notNull().references('app_user.id').onDelete('restrict'))
    .addColumn('reason', 'text', (col) => col.notNull())
    .addColumn('starts_at', 'timestamptz', (col) => col.notNull())
    .addColumn('ends_at', 'timestamptz', (col) => col.notNull())
    .addColumn('no_show_count', 'integer')
    .addColumn('lifted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('booking_block_reason_ck', sql`reason IN ('no_show', 'manual')`)
    .addCheckConstraint('booking_block_period_ck', sql`ends_at >= starts_at`)
    .addCheckConstraint('booking_block_no_show_count_ck', sql`reason <> 'no_show' OR no_show_count >= 1`)
    .execute();
  await db.schema
    .createIndex('booking_block_member_ends_idx')
    .on('booking_block')
    .columns(['member_id', 'ends_at'])
    .execute();

  await db.schema
    .alterTable('booking')
    .addColumn('no_show_block_id', 'uuid', (col) => col.references('booking_block.id').onDelete('set null'))
    .execute();
  await db.schema
    .createIndex('booking_uncounted_no_show_idx')
    .on('booking')
    .column('member_id')
    .where(sql<boolean>`attendance = 'no_show' AND no_show_block_id IS NULL`)
    .execute();
}

/**
 * Blocks are lost, so every member is unblocked. `booking.attendance` stays: it belongs to US-129 and holds
 * attendance data that this rollback must not destroy.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('booking_uncounted_no_show_idx').ifExists().execute();
  await db.schema.alterTable('booking').dropColumn('no_show_block_id').execute();
  await db.schema.dropTable('booking_block').execute();
}
