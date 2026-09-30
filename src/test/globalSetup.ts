import { execSync } from 'node:child_process';

// Runs once before all tests: create the test database if needed and apply every migration
// (including the raw SQL exclusion constraint), exactly like production.
export default function setup() {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
