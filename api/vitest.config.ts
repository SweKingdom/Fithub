import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { TZ: 'UTC' },
    // Integration tests share one database, so test files run serially.
    // (Vitest 2 only accepts this option at the root, not per workspace project.)
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**'],
    },
  },
});
