import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { getTestDatabaseUrl, getTestDb, resetDb } from '../helpers/db.js';

describe('GET /health (test database)', () => {
  const db = getTestDb();
  let app: FastifyInstance;

  beforeAll(() => {
    const config = loadConfig({ DATABASE_URL: getTestDatabaseUrl(), NODE_ENV: 'test' });
    app = buildApp({ config, db });
  });

  beforeEach(async () => {
    await resetDb(db);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it('returns 200 with status ok and db ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', db: 'ok' });
  });
});
