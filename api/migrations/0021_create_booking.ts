import { sql, type Kysely } from 'kysely';

/**
 * Bookings of a class by a member (US-122). Free places are not stored: they are derived from the
 * active rows (`confirmed`, `pending_payment`) of this table (ADR-010).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('booking')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('class_id', 'uuid', (col) => col.notNull().references('gym_class.id').onDelete('restrict'))
    .addColumn('member_id', 'uuid', (col) => col.notNull().references('app_user.id').onDelete('restrict'))
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('attendance', 'text', (col) => col.notNull().defaultTo('unknown'))
    .addColumn('source', 'text', (col) => col.notNull().defaultTo('direct'))
    .addColumn('booked_at', 'timestamptz', (col) => col.notNull())
    .addColumn('cancelled_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('booking_status_ck', sql`status IN ('pending_payment', 'confirmed', 'cancelled')`)
    .addCheckConstraint('booking_attendance_ck', sql`attendance IN ('unknown', 'attended', 'no_show')`)
    .addCheckConstraint('booking_source_ck', sql`source IN ('direct', 'waitlist')`)
    .addCheckConstraint('booking_cancelled_at_ck', sql`(status = 'cancelled') = (cancelled_at IS NOT NULL)`)
    .execute();

  // DB-level guard against double booking; cancelled rows may repeat.
  await db.schema
    .createIndex('booking_active_member_class_uq')
    .on('booking')
    .columns(['class_id', 'member_id'])
    .unique()
    .where(sql.ref('status'), 'in', [sql.lit('pending_payment'), sql.lit('confirmed')])
    .execute();
  await db.schema.createIndex('booking_class_status_idx').on('booking').columns(['class_id', 'status']).execute();
  await db.schema.createIndex('booking_member_idx').on('booking').column('member_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('booking').execute();
}
