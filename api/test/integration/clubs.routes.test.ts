import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClubDatabase } from '../../src/modules/clubs/db-types.js';
import { clubRoutes } from '../../src/modules/clubs/routes.js';
import { testDb } from '../helpers/db.js';

/**
 * The plugin is mounted in an `/api` scope like `buildApp` does. The 401 case belongs to the global
 * auth hook and is proven by the US-118 route-protection test.
 */
describe('GET /api/clubs (US-117, AC 6)', () => {
  const db = testDb() as unknown as Kysely<ClubDatabase>;
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(async (api) => api.register(clubRoutes({ db })), { prefix: '/api' });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await sql`TRUNCATE club CASCADE`.execute(db);
  });

  it('returns an empty array when there are no clubs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/clubs' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns all clubs sorted by name, with only id, code, name and timezone', async () => {
    await db
      .insertInto('club')
      .values([
        { code: 'ZED', name: 'Zed Club', timezone: 'UTC' },
        { code: 'ALPHA', name: 'Alpha Club', timezone: 'Europe/Stockholm' },
        { code: 'MID', name: 'Mid Club', timezone: 'Europe/London' },
      ])
      .execute();

    const res = await app.inject({ method: 'GET', url: '/api/clubs' });

    expect(res.statusCode).toBe(200);
    const body = res.json<Array<Record<string, string>>>();
    expect(body.map((club) => club.name)).toEqual(['Alpha Club', 'Mid Club', 'Zed Club']);
    expect(body.map((club) => club.timezone)).toEqual(['Europe/Stockholm', 'Europe/London', 'UTC']);
    for (const club of body) {
      expect(Object.keys(club).sort()).toEqual(['code', 'id', 'name', 'timezone']);
      expect(club.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
