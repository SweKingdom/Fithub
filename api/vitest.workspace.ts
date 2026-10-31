import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      include: ['test/unit/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'integration',
      include: ['test/integration/**/*.test.ts'],
      environment: 'node',
      globalSetup: ['test/helpers/integration-global-setup.ts'],
      testTimeout: 15000,
    },
  },
]);
