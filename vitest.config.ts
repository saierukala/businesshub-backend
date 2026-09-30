import 'dotenv/config';
import { defineConfig } from 'vitest/config';

// Tests run against a separate database (TEST_DATABASE_URL) that they wipe between tests.
// Guard: refuse to run against anything whose name does not contain "test".
const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl || !/test/i.test(new URL(testDbUrl).pathname)) {
  throw new Error('Set TEST_DATABASE_URL in .env to a database whose name contains "test"');
}

export default defineConfig({
  test: {
    globalSetup: ['./src/test/globalSetup.ts'],
    fileParallelism: false, // test files share one database
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDbUrl,
      JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
      FRONTEND_URL: 'http://localhost:3000',
      LOG_LEVEL: 'silent',
    },
  },
});
