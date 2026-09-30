import { handlers } from '../jobs/handlers';
import { testQueue } from '../jobs/queue';
import type { NotifyJob } from '../jobs/types';

// Runs the queued jobs that are due at `now`, like the worker would (reminders scheduled for later stay queued).
// Returns what each one did, so a test can also check that a stale job was skipped.
export async function runJobs(now = new Date()) {
  const results: { name: string; type: string; result: unknown }[] = [];
  for (const job of testQueue.takeDue(now)) {
    const data = job.data as NotifyJob;
    results.push({ name: job.name, type: data.type, result: await handlers[job.name](data, now) });
  }
  return results;
}

// What is waiting in the queue (name, type, when it is due), oldest first.
export const queued = () =>
  testQueue.jobs().map((j) => ({ name: j.name, type: (j.data as NotifyJob).type, startAfter: j.startAfter, data: j.data as NotifyJob }));
