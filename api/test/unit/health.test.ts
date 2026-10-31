import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
} from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { Database } from '../../src/db/schema.js';

function createStubDb(acquire: () => Promise<DatabaseConnection>): Kysely<Database> {
  const driver: Driver = {
    init: () => Promise.resolve(),
    acquireConnection: acquire,
    beginTransaction: () => Promise.resolve(),
    commitTransaction: () => Promise.resolve(),
    rollbackTransaction: () => Promise.resolve(),
    releaseConnection: () => Promise.resolve(),
    destroy: () => Promise.resolve(),
  };
  return new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (db: Kysely<Database>) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}

const config = loadConfig({ DATABASE_URL: 'postgres://u:p@localhost:5432/stub', NODE_ENV: 'test' });

describe('GET /health (database stub)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 503 without error detail when the query fails', async () => {
    const db = createStubDb(() => Promise.reject(new Error('connection refused by secret-host')));
    const app = buildApp({ config, db });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'error', db: 'unreachable' });
    expect(response.body).not.toContain('secret-host');
    await app.close();
  });

  it('returns 503 when the query does not answer within 2 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const db = createStubDb(() => new Promise<DatabaseConnection>(() => undefined));
    const app = buildApp({ config, db });

    const pending = app.inject({ method: 'GET', url: '/health' });
    await vi.advanceTimersByTimeAsync(2000);
    const response = await pending;

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'error', db: 'unreachable' });
    await app.close();
  });
});
