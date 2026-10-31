import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Local runs read DATABASE_URL / TEST_DATABASE_URL from the git-ignored `.env`; CI exports them.
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/helpers/integration-global-setup.ts'],
    // One real PostgreSQL database: test files run one after the other.
    fileParallelism: false,
    testTimeout: 30000,
    env: {
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'test',
      TZ: 'UTC',
      AUTH_SCRYPT_COST: '16384',
    },
  },
});
