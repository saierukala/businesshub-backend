import { processNotification } from '../services/notification.service';
import type { NotifyJob } from './types';
import { JOB, type JobName } from './types';

// One handler per job name. Notifications, reminders and review requests all end up in the same processor:
// the difference is only WHEN they are queued and the guards (booking moved? still completed?) carried in the job.
export const handlers: Record<JobName, (data: NotifyJob, now?: Date) => Promise<unknown>> = {
  [JOB.notify]: processNotification,
  [JOB.reminder]: processNotification,
  [JOB.reviewRequest]: processNotification,
};
