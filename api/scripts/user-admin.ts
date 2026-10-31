import { parseArgs } from 'node:util';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { ConfigError, loadConfig } from '../src/config.js';
import type { AuthDatabase } from '../src/modules/auth/db-types.js';
import { createUser, setPassword, UserAdminError } from '../src/modules/auth/user-admin.js';
import { systemClock } from '../src/shared/clock.js';

const USAGE = [
  'Usage:',
  '  npm run user:create -w api -- --email <email> --name <full name> --role <member|instructor|club_manager> [--club <CODE>] [--member-type <regular|drop_in>] --password-stdin',
  '  npm run user:set-password -w api -- --email <email> --password-stdin',
  'The password is read from standard input, never from an argument.',
].join('\n');

/** Reads all of stdin and removes one trailing line break (what `echo` adds). */
async function readPassword(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

/** Thin CLI: parses arguments, calls the service, prints one line. Exit 0 = done, 1 = nothing changed. */
async function main(): Promise<number> {
  let values;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      options: {
        email: { type: 'string' },
        name: { type: 'string' },
        role: { type: 'string' },
        club: { type: 'string' },
        'member-type': { type: 'string' },
        'password-stdin': { type: 'boolean' },
      },
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    console.error(`${(error as Error).message}.\n${USAGE}`);
    return 1;
  }

  const command = positionals[0];
  if (command !== 'create' && command !== 'set-password') {
    console.error(`Unknown command. ${USAGE}`);
    return 1;
  }
  if (!values.email) {
    console.error(`--email is required.\n${USAGE}`);
    return 1;
  }
  if (!values['password-stdin']) {
    console.error(`--password-stdin is required: pipe the password in.\n${USAGE}`);
    return 1;
  }
  if (command === 'create' && (!values.name || !values.role)) {
    console.error(`--name and --role are required.\n${USAGE}`);
    return 1;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set.');
    return 1;
  }

  let cost: number;
  try {
    cost = loadConfig().auth.scryptCost;
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }

  const password = await readPassword();
  const db = new Kysely<AuthDatabase>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl }) }),
  });

  try {
    if (command === 'create') {
      const user = await createUser(
        db,
        {
          email: values.email,
          fullName: values.name as string,
          role: values.role as string,
          clubCode: values.club,
          memberType: values['member-type'],
          password,
        },
        cost,
        systemClock.now(),
      );
      console.log(`Created ${user.role} ${user.email} (${user.id}).`);
    } else {
      const result = await setPassword(db, values.email, password, cost, systemClock.now());
      console.log(`Password updated for ${result.email}; ${result.sessionsEnded} sessions ended.`);
    }
    return 0;
  } catch (error) {
    if (error instanceof UserAdminError) {
      console.error(error.message);
    } else {
      console.error(`The command failed and nothing was changed: ${(error as Error).message}`);
    }
    return 1;
  } finally {
    await db.destroy();
  }
}

process.exitCode = await main();
