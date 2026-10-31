import { sql, type Kysely } from 'kysely';

/**
 * Class credits (US-125, ADR-017): one balance row per member that ever had credits (a missing row means 0)
 * and an append-only ledger. The balance always equals the sum of the member's ledger deltas.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('credit_balance')
    .addColumn('member_id', 'uuid', (col) => col.primaryKey().references('app_user.id').onDelete('restrict'))
    .addColumn('balance', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('credit_balance_non_negative_ck', sql`balance >= 0`)
    .execute();

  await db.schema
    .createTable('credit_transaction')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('member_id', 'uuid', (col) => col.notNull().references('app_user.id').onDelete('restrict'))
    .addColumn('delta', 'integer', (col) => col.notNull())
    .addColumn('reason', 'text', (col) => col.notNull())
    .addColumn('booking_id', 'uuid', (col) => col.references('booking.id').onDelete('restrict'))
    .addColumn('balance_after', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'credit_transaction_reason_ck',
      sql`reason IN ('migration','booking','cancellation_refund','class_cancelled_refund','manual_adjustment')`,
    )
    .addCheckConstraint(
      'credit_transaction_delta_ck',
      sql`(reason = 'booking' AND delta = -1)
        OR (reason IN ('cancellation_refund','class_cancelled_refund') AND delta = 1)
        OR (reason = 'migration' AND delta > 0)
        OR (reason = 'manual_adjustment' AND delta <> 0)`,
    )
    .addCheckConstraint(
      'credit_transaction_booking_ck',
      sql`(booking_id IS NOT NULL) = (reason IN ('booking','cancellation_refund','class_cancelled_refund'))`,
    )
    .addCheckConstraint('credit_transaction_balance_after_ck', sql`balance_after >= 0`)
    .execute();

  await sql`CREATE UNIQUE INDEX credit_transaction_booking_debit_uq
    ON credit_transaction (booking_id) WHERE reason = 'booking'`.execute(db);
  await sql`CREATE UNIQUE INDEX credit_transaction_booking_refund_uq
    ON credit_transaction (booking_id) WHERE reason IN ('cancellation_refund','class_cancelled_refund')`.execute(db);
  await sql`CREATE UNIQUE INDEX credit_transaction_migration_uq
    ON credit_transaction (member_id) WHERE reason = 'migration'`.execute(db);
  await db.schema
    .createIndex('credit_transaction_member_idx')
    .on('credit_transaction')
    .columns(['member_id', 'created_at'])
    .execute();
}

/** Drops the ledger first, then the balances. After go-live this deletes imported balances: export both tables first. */
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('credit_transaction').execute();
  await db.schema.dropTable('credit_balance').execute();
}
