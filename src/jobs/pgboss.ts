import { PgBoss } from 'pg-boss';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { JOB, RETRY } from './types';

// pg-boss keeps its jobs in its own "pgboss" schema in the same PostgreSQL database (no Redis needed).
// Prisma's URL may carry "?schema=public", which the pg driver does not understand: drop it.
function connectionString() {
  const url = new URL(env.DATABASE_URL);
  url.searchParams.delete('schema');
  return url.toString();
}

let boss: Promise<PgBoss> | undefined;

// One shared instance per process. The API only ENQUEUES (producer); it does not run the maintenance loops.
// The worker process calls with supervise = true to also run them.
export function getBoss({ supervise = false }: { supervise?: boolean } = {}): Promise<PgBoss> {
  boss ??= (async () => {
    const b = new PgBoss({ connectionString: connectionString(), supervise, schedule: false });
    b.on('error', (err) => logger.error({ err }, 'pg-boss error'));
    await b.start();
    for (const name of Object.values(JOB)) {
      // Safe to repeat: the queue may already exist (created by the API or the worker).
      await b.createQueue(name, { ...RETRY }).catch((err: Error) => {
        if (!/already exists/i.test(err.message)) throw err;
      });
    }
    return b;
  })();
  boss.catch(() => {
    boss = undefined; // let the next call try again instead of caching a failed start
  });
  return boss;
}

export async function stopBoss() {
  if (!boss) return;
  const b = await boss;
  boss = undefined;
  await b.stop({ graceful: true });
}
