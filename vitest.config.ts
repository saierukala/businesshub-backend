import { defineConfig } from 'vitest/config';

// Test-only environment so tests never need a real .env or a running database.
export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
      FRONTEND_URL: 'http://localhost:3000',
      LOG_LEVEL: 'silent',
    },
  },
});
