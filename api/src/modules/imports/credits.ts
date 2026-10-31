import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { Clock } from '../../shared/clock.js';
import { readCsvFile } from './csv.js';
import { planCreditImport } from './credits.plan.js';
import { creditTablesExist, insertMigrationTransactions, loadCreditSnapshot, upsertBalances } from './credits.repository.js';
import type { CreditImportResult } from './credits.report.js';
import type { CreditImportPlan } from './credits.types.js';
import { ImportFileError } from './errors.js';
import { lockImports } from './repository.js';

export interface CreditImportOptions {
  file: string;
  delimiter: string;
  dryRun: boolean;
  clock: Clock;
}

/**
 * Imports class credit balances (US-136). A real run reads, plans and writes in one transaction
 * under the shared import lock; a dry run only plans. File and database problems throw
 * `ImportFileError` or the database error, with nothing written.
 */
export async function importCredits(db: Kysely<Database>, options: CreditImportOptions): Promise<CreditImportResult> {
  const startedAt = options.clock.now();
  const { columns, rows } = readCsvFile(options.file, {
    delimiter: options.delimiter,
    required: ['credits'],
    optional: ['legacy_member_number', 'email'],
  });
  if (!columns.includes('legacy_member_number') && !columns.includes('email')) {
    throw new ImportFileError('Missing column(s): legacy_member_number or email.');
  }
  if (!(await creditTablesExist(db))) {
    throw new ImportFileError('Credit tables not found. Run the migrations first.');
  }
  const fileSha256 = createHash('sha256').update(readFileSync(options.file)).digest('hex');

  const finish = (plan: CreditImportPlan): CreditImportResult => ({
    ...plan,
    file: options.file,
    fileSha256,
    dryRun: options.dryRun,
    startedAt: startedAt.toISOString(),
    finishedAt: options.clock.now().toISOString(),
  });

  if (options.dryRun) {
    return finish(planCreditImport(rows, await loadCreditSnapshot(db)));
  }

  const plan = await db.transaction().execute(async (trx) => {
    await lockImports(trx);
    const planned = planCreditImport(rows, await loadCreditSnapshot(trx));
    if (!planned.balanced) {
      throw new ImportFileError('The credit totals do not add up. Nothing was written.');
    }
    const now = options.clock.now();
    const balances = await upsertBalances(trx, planned.loads, now);
    await insertMigrationTransactions(trx, planned.loads, balances, now);
    return planned;
  });
  return finish(plan);
}
