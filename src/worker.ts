import 'dotenv/config';
import { logger } from './config/logger';
import { getBoss, stopBoss } from './jobs/pgboss';
import { handlers } from './jobs/handlers';
import { JOB, type JobName, type NotifyJob } from './jobs/types';

// The background worker: `npm run worker`. A separate process from the API, same codebase and database.
// It takes jobs off the queue (emails, in-app notifications, reminders, review requests). A job that throws is
// retried later with growing waits (see RETRY in jobs/types.ts); failures are logged here.
async function main() {
  const boss = await getBoss({ supervise: true }); // the worker also runs pg-boss's own maintenance

  for (const name of Object.values(JOB) as JobName[]) {
    await boss.work<NotifyJob>(name, async (jobs) => {
      for (const job of jobs) {
        try {
          const result = await handlers[name](job.data);
          logger.info({ job: name, id: job.id, type: job.data.type, result }, 'Job done');
        } catch (err) {
          logger.error({ err, job: name, id: job.id, type: job.data.type, attempt: job.retryCount + 1 }, 'Job failed, will retry');
          throw err; // tells pg-boss to retry with backoff
        }
      }
    });
  }
  logger.info('Worker started: waiting for jobs');

  const stop = async () => {
    logger.info('Worker stopping');
    await stopBoss();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  logger.error({ err }, 'Worker crashed');
  process.exit(1);
});
