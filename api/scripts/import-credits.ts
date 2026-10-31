import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from '../src/db/schema.js';
import { importCredits } from '../src/modules/imports/credits.js';
import { formatCreditSummaryLine, writeCreditReport } from '../src/modules/imports/credits.report.js';
import { ImportFileError } from '../src/modules/imports/errors.js';
import { systemClock } from '../src/shared/clock.js';

const USAGE =
  'Usage: npm run import:credits -w api -- --file <path> [--delimiter ","] [--dry-run] [--out-dir <dir>]';

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Operator CLI: imports class credit balances from the credits file (US-136). */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      delimiter: { type: 'string', default: ',' },
      'dry-run': { type: 'boolean', default: false },
      'out-dir': { type: 'string' },
    },
  });

  if (!values.file) {
    console.error(`Missing --file. ${USAGE}`);
    return 1;
  }
  const delimiter = values.delimiter === '\\t' ? '\t' : (values.delimiter ?? ',');
  if (delimiter.length !== 1) {
    console.error(`--delimiter must be one character. ${USAGE}`);
    return 1;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set.');
    return 1;
  }

  const outDir = resolve(values['out-dir'] ?? `import-output/credits-${utcStamp(systemClock.now())}`);
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl }) }),
  });
  try {
    const result = await importCredits(db, {
      file: resolve(values.file),
      delimiter,
      dryRun: values['dry-run'],
      clock: systemClock,
    });
    writeCreditReport(outDir, result);
    console.log(formatCreditSummaryLine(result, outDir));
    if (!result.balanced) {
      console.error('The credit totals do not add up. Nothing was written.');
      return 1;
    }
    return 0;
  } catch (error) {
    if (error instanceof ImportFileError) {
      console.error(error.message);
    } else {
      console.error('The credit import failed and nothing was written. Check the database connection and try again.');
      console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    }
    return 1;
  } finally {
    await db.destroy();
  }
}

process.exitCode = await main();
