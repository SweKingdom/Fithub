import { sql, type Kysely } from 'kysely';

/** Creates `gym_class` (US-120). Status is `text` + CHECK, not a PostgreSQL enum (ADR-008). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('gym_class')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('club_id', 'uuid', (col) => col.notNull().references('club.id').onDelete('restrict'))
    .addColumn('name', 'varchar(100)', (col) => col.notNull())
    .addColumn('start_at', 'timestamptz', (col) => col.notNull())
    .addColumn('duration_minutes', 'integer', (col) => col.notNull())
    .addColumn('capacity', 'integer', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('scheduled'))
    .addColumn('instructor_id', 'uuid', (col) => col.references('app_user.id').onDelete('set null'))
    .addColumn('created_by', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('gym_class_name_ck', sql`length(btrim(name)) > 0`)
    .addCheckConstraint('gym_class_duration_ck', sql`duration_minutes > 0`)
    .addCheckConstraint('gym_class_capacity_ck', sql`capacity >= 1`)
    .addCheckConstraint('gym_class_status_ck', sql`status IN ('scheduled', 'cancelled')`)
    .execute();

  await db.schema
    .createIndex('gym_class_club_start_idx')
    .on('gym_class')
    .columns(['club_id', 'start_at'])
    .execute();
  await db.schema
    .createIndex('gym_class_instructor_idx')
    .on('gym_class')
    .column('instructor_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('gym_class').execute();
}
