import { sql, type Kysely } from 'kysely';

/**
 * Bookings. Minimal shape that the schedule read (US-121) needs; US-122 extends it when booking is built.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('booking')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('class_id', 'uuid', (col) => col.notNull().references('gym_class.id').onDelete('restrict'))
    .addColumn('member_id', 'uuid', (col) => col.notNull().references('app_user.id').onDelete('restrict'))
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('booking_status_ck', sql`status IN ('confirmed', 'pending_payment', 'cancelled')`)
    .execute();
  await db.schema
    .createIndex('booking_active_member_class_uq')
    .on('booking')
    .columns(['class_id', 'member_id'])
    .unique()
    .where(sql<boolean>`status IN ('confirmed', 'pending_payment')`)
    .execute();
  await db.schema.createIndex('booking_member_idx').on('booking').column('member_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('booking').execute();
}
