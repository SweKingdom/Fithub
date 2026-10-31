import { sql, type Kysely } from 'kysely';

/**
 * Maps every legacy member number, including numbers merged away, to the member (US-135, ADR-022),
 * so that US-136 can resolve credits for merged rows.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('import_member_alias')
    .addColumn('legacy_member_id', 'text', (col) => col.primaryKey())
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('app_user.id').onDelete('restrict'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('import_member_alias_legacy_len_ck', sql`length(legacy_member_id) BETWEEN 1 AND 64`)
    .execute();
  await db.schema.createIndex('import_member_alias_user_idx').on('import_member_alias').column('user_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('import_member_alias').execute();
}
