import type { Kysely } from 'kysely';
import { createDb } from '../../src/db/client.js';
import type { Database } from '../../src/db/schema.js';
import { assertTestDatabase } from './test-database.js';

let shared: Kysely<Database> | undefined;

/** The one connection of a test file to the test database. The name guard runs before the first connection. */
export function testDb(): Kysely<Database> {
  if (!shared) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set for the integration tests.');
    assertTestDatabase(url);
    shared = createDb(url);
  }
  return shared;
}
