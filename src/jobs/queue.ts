import { env } from '../config/env';
import { logger } from '../config/logger';
import { getBoss } from './pgboss';
import type { JobName } from './types';

// The API talks to jobs only through this. In production it is pg-boss. In tests it is an in-memory list, so a
// test can look at what was queued and run it, without a worker process or a second database schema.
export type Enqueue = (name: JobName, data: object, options?: { startAfter?: Date }) => Promise<void>;

const pgQueue: Enqueue = async (name, data, options) => {
  const boss = await getBoss();
  await boss.send(name, data, options?.startAfter ? { startAfter: options.startAfter } : undefined);
};

// ---- in-memory queue for tests ----
export type MemoryJob = { name: JobName; data: object; startAfter: Date | null };
const memory: MemoryJob[] = [];

const memoryQueue: Enqueue = async (name, data, options) => {
  memory.push({ name, data, startAfter: options?.startAfter ?? null });
};

export const testQueue = {
  jobs: () => [...memory],
  clear: () => {
    memory.length = 0;
  },
  // Removes and returns the jobs that are due at `now` (reminders scheduled for later stay queued).
  takeDue: (now: Date) => {
    const due = memory.filter((j) => !j.startAfter || j.startAfter <= now);
    for (const j of due) memory.splice(memory.indexOf(j), 1);
    return due;
  },
};

// Wrapped in an object so a test can make it fail and check that bookings still work.
export const queueApi: { enqueue: Enqueue } = { enqueue: env.NODE_ENV === 'test' ? memoryQueue : pgQueue };

// The booking API must never fail because the queue is down: the booking is already saved.
// So events enqueue through this, which logs the problem and moves on.
export async function safeEnqueue(name: JobName, data: object, options?: { startAfter?: Date }) {
  try {
    await queueApi.enqueue(name, data, options);
  } catch (err) {
    logger.error({ err, name, data }, 'Could not enqueue job');
  }
}
