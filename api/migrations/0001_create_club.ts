import { sql, type Kysely } from 'kysely';

/** Clubs (US-117): the four gyms. `code` is what operators type, `timezone` shows class times locally. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('club')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('code', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('timezone', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('club_code_uq', ['code'])
    .addCheckConstraint('club_code_len_ck', sql`length(code) BETWEEN 1 AND 32`)
    .addCheckConstraint('club_name_len_ck', sql`length(btrim(name)) BETWEEN 1 AND 200`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('club').execute();
}
