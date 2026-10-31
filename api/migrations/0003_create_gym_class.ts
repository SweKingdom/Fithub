import { sql, type Kysely } from 'kysely';

/**
 * Classes. Minimal shape that the schedule read (US-121) needs; US-120 extends it when class creation is built.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('gym_class')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('club_id', 'uuid', (col) => col.notNull().references('club.id').onDelete('restrict'))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('start_at', 'timestamptz', (col) => col.notNull())
    .addColumn('duration_minutes', 'integer', (col) => col.notNull())
    .addColumn('capacity', 'integer', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('scheduled'))
    .addColumn('instructor_id', 'uuid', (col) => col.references('app_user.id').onDelete('restrict'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('gym_class_status_ck', sql`status IN ('scheduled', 'cancelled')`)
    .addCheckConstraint('gym_class_capacity_ck', sql`capacity > 0`)
    .addCheckConstraint('gym_class_duration_ck', sql`duration_minutes > 0`)
    .execute();
  await db.schema.createIndex('gym_class_club_start_idx').on('gym_class').columns(['club_id', 'start_at']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('gym_class').execute();
}
