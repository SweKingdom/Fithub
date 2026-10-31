import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The SPA and the API share one origin (the session cookie is SameSite=Strict, Path=/api).
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    // Lets Testing Library unmount rendered components after every test.
    globals: true,
  },
});
