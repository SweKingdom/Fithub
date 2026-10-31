import { sql, type Kysely } from 'kysely';

/**
 * Users and server-side sessions (US-118, ADR-014).
 * The CHECK constraints enforce the role / member type / club rules for every writer, also the import (US-135).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('app_user')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('full_name', 'text', (col) => col.notNull())
    .addColumn('role', 'text', (col) => col.notNull())
    .addColumn('member_type', 'text')
    .addColumn('club_id', 'uuid', (col) => col.references('club.id').onDelete('restrict'))
    .addColumn('password_hash', 'text')
    .addColumn('legacy_member_id', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('app_user_legacy_member_id_uq', ['legacy_member_id'])
    .addCheckConstraint('app_user_email_len_ck', sql`length(email) BETWEEN 3 AND 254`)
    .addCheckConstraint('app_user_full_name_len_ck', sql`length(btrim(full_name)) BETWEEN 1 AND 200`)
    .addCheckConstraint('app_user_role_ck', sql`role IN ('member', 'instructor', 'club_manager')`)
    .addCheckConstraint('app_user_member_type_ck', sql`member_type IN ('regular', 'drop_in')`)
    .addCheckConstraint(
      'app_user_member_type_role_ck',
      sql`(role = 'member') = (member_type IS NOT NULL)`,
    )
    .addCheckConstraint('app_user_staff_club_ck', sql`role = 'member' OR club_id IS NOT NULL`)
    .execute();

  await db.schema
    .createIndex('app_user_email_lower_uq')
    .on('app_user')
    .unique()
    .expression(sql`lower(email)`)
    .execute();
  await db.schema.createIndex('app_user_club_idx').on('app_user').column('club_id').execute();

  await db.schema
    .createTable('user_session')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('app_user.id').onDelete('cascade'))
    .addColumn('token_hash', 'bytea', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull())
    .addColumn('last_seen_at', 'timestamptz', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addUniqueConstraint('user_session_token_hash_uq', ['token_hash'])
    .execute();
  await db.schema.createIndex('user_session_user_idx').on('user_session').column('user_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('user_session').execute();
  await db.schema.dropTable('app_user').execute();
}
