import { sql, type Kysely } from 'kysely';

/**
 * Waiting list (US-127 defines the table, US-128 promotes from it). Provisional number: renumber if the folder
 * differs at merge; it must come after the `booking` migration (FK `promoted_booking_id`).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('waitlist_entry')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('class_id', 'uuid', (col) => col.notNull().references('gym_class.id').onDelete('restrict'))
    .addColumn('member_id', 'uuid', (col) => col.notNull().references('app_user.id').onDelete('restrict'))
    .addColumn('queue_seq', 'bigint', (col) => col.notNull().generatedAlwaysAsIdentity())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('waiting'))
    .addColumn('joined_at', 'timestamptz', (col) => col.notNull())
    .addColumn('ended_at', 'timestamptz')
    .addColumn('promoted_booking_id', 'uuid', (col) => col.references('booking.id').onDelete('restrict'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('waitlist_entry_queue_seq_uq', ['queue_seq'])
    .addCheckConstraint(
      'waitlist_entry_status_ck',
      sql`status IN ('waiting', 'promoted', 'removed', 'expired')`,
    )
    .addCheckConstraint('waitlist_entry_ended_ck', sql`(status = 'waiting') = (ended_at IS NULL)`)
    .addCheckConstraint(
      'waitlist_entry_promoted_ck',
      sql`promoted_booking_id IS NULL OR status = 'promoted'`,
    )
    .execute();
  await db.schema
    .createIndex('waitlist_entry_waiting_class_member_uq')
    .ifNotExists()
    .on('waitlist_entry')
    .columns(['class_id', 'member_id'])
    .unique()
    .where(sql<boolean>`status = 'waiting'`)
    .execute();
  await db.schema
    .createIndex('waitlist_entry_class_status_seq_idx')
    .ifNotExists()
    .on('waitlist_entry')
    .columns(['class_id', 'status', 'queue_seq'])
    .execute();
  await db.schema
    .createIndex('waitlist_entry_member_status_idx')
    .ifNotExists()
    .on('waitlist_entry')
    .columns(['member_id', 'status'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('waitlist_entry').ifExists().execute();
}
