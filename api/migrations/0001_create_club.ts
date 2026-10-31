import { sql, type Kysely } from 'kysely';

/**
 * Club reference data (US-117). Rows are written only by the seed CLI (`api/scripts/seed-clubs.ts`).
 * The time zone is validated by the seed: PostgreSQL cannot CHECK an IANA name immutably.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('club')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('code', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('timezone', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('club_code_format_ck', sql`code ~ '^[A-Z0-9-]{2,20}$'`)
    .addUniqueConstraint('club_code_uq', ['code'])
    .addCheckConstraint('club_name_len_ck', sql`length(btrim(name)) BETWEEN 1 AND 100`)
    .execute();
  await db.schema
    .createIndex('club_name_lower_uq')
    .on('club')
    .unique()
    .expression(sql`lower(name)`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('club').execute();
}
