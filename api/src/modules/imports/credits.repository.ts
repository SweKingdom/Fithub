import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { CreditLoad, CreditSnapshot } from './credits.types.js';

const CHUNK_SIZE = 500;

function chunks<T>(items: T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) result.push(items.slice(i, i + CHUNK_SIZE));
  return result;
}

/** True when both credit tables (US-125) exist in the current schema. */
export async function creditTablesExist(db: Kysely<Database>): Promise<boolean> {
  const result = await sql<{ table_name: string }>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN ('credit_balance', 'credit_transaction')
  `.execute(db);
  return result.rows.length === 2;
}

/** Reads what the plan needs: aliases, users and the existing `migration` ledger totals. */
export async function loadCreditSnapshot(db: Kysely<Database>): Promise<CreditSnapshot> {
  const aliasRows = await db.selectFrom('import_member_alias').select(['legacy_member_id', 'user_id']).execute();
  const userRows = await db
    .selectFrom('app_user')
    .select(['id', sql<string>`lower(email)`.as('email'), 'role', 'member_type'])
    .execute();
  const migrationRows = await db
    .selectFrom('credit_transaction')
    .select(['member_id', 'delta'])
    .where('reason', '=', 'migration')
    .execute();

  const migrated = new Map<string, number>();
  for (const row of migrationRows) {
    migrated.set(row.member_id, (migrated.get(row.member_id) ?? 0) + Number(row.delta));
  }

  return {
    aliases: new Map(aliasRows.map((row) => [row.legacy_member_id, row.user_id])),
    usersById: new Map(
      userRows.map((row) => [row.id, { id: row.id, role: row.role, memberType: row.member_type ?? null }]),
    ),
    usersByEmail: new Map(userRows.map((row) => [row.email, row.id])),
    migrated,
  };
}

/**
 * Adds each load to the member's balance (creating the row when missing) and returns the new
 * balance per member id. Each member appears once, so a chunk never updates a row twice.
 */
export async function upsertBalances(
  trx: Kysely<Database>,
  loads: CreditLoad[],
  now: Date,
): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  for (const chunk of chunks(loads)) {
    const rows = await trx
      .insertInto('credit_balance')
      .values(chunk.map((load) => ({ member_id: load.userId, balance: load.total, updated_at: now })))
      .onConflict((oc) =>
        oc.column('member_id').doUpdateSet({
          balance: sql`credit_balance.balance + excluded.balance`,
          updated_at: now,
        }),
      )
      .returning(['member_id', 'balance'])
      .execute();
    for (const row of rows) balances.set(row.member_id, Number(row.balance));
  }
  return balances;
}

/** Appends one `migration` ledger row per load. `credit_transaction_migration_uq` guards duplicates. */
export async function insertMigrationTransactions(
  trx: Kysely<Database>,
  loads: CreditLoad[],
  balances: Map<string, number>,
  now: Date,
): Promise<void> {
  for (const chunk of chunks(loads)) {
    await trx
      .insertInto('credit_transaction')
      .values(
        chunk.map((load) => ({
          member_id: load.userId,
          delta: load.total,
          reason: 'migration' as const,
          booking_id: null,
          balance_after: balances.get(load.userId) as number,
          created_at: now,
        })),
      )
      .execute();
  }
}
