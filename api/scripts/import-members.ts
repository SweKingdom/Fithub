import { parseArgs } from 'node:util';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { ImportDatabase } from '../src/modules/imports/db-types.js';
import { ImportFileError } from '../src/modules/imports/errors.js';
import { importMembers } from '../src/modules/imports/members.js';
import { formatSummaryLine, writeImportReport } from '../src/modules/imports/report.js';
import { systemClock } from '../src/shared/clock.js';

const USAGE =
  'Usage: npm run import:members -w api -- --file <path> [--type-map <path>] [--delimiter ","] [--dry-run] [--out-dir <dir>]';

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Thin CLI: parses arguments, runs the import, writes the reports. Exit 0 = run completed, 1 = nothing written. */
async function main(): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        file: { type: 'string' },
        'type-map': { type: 'string' },
        delimiter: { type: 'string' },
        'dry-run': { type: 'boolean' },
        'out-dir': { type: 'string' },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(`${(error as Error).message}. ${USAGE}`);
    return 1;
  }

  if (!values.file) {
    console.error(`--file is required. ${USAGE}`);
    return 1;
  }
  const delimiter = values.delimiter === '\\t' ? '\t' : (values.delimiter ?? ',');
  if (delimiter.length !== 1) {
    console.error('--delimiter must be one character.');
    return 1;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set.');
    return 1;
  }

  const outDir = values['out-dir'] ?? `import-output/members-${timestamp(systemClock.now())}`;
  const db = new Kysely<ImportDatabase>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl }) }),
  });

  try {
    const result = await importMembers(db, {
      file: values.file,
      typeMapPath: values['type-map'] ?? 'seed/member-type-map.json',
      delimiter,
      dryRun: values['dry-run'] ?? false,
      clock: systemClock,
    });
    writeImportReport(outDir, result);
    console.log(formatSummaryLine(result, outDir));
    if (!result.plan.balanced) {
      console.error('The import counts do not add up (see import-summary.json).');
      return 1;
    }
    return 0;
  } catch (error) {
    if (error instanceof ImportFileError) {
      console.error(error.message);
    } else {
      // The message of a database error holds no row values; nothing was written (one transaction).
      console.error(`The import failed and nothing was written: ${(error as Error).message}`);
    }
    return 1;
  } finally {
    await db.destroy();
  }
}

process.exitCode = await main();
