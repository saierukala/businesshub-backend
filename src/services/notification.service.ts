import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { pageArgs, toPage } from '../db/paginate';
import { AppError } from '../errors/AppError';
import type { NotifyJob } from '../jobs/types';
import { mailer } from './email.service';
import { buildMessages, type BuildCtx } from './notification.build';
import { amountDue } from './booking.view';
import type { ListNotificationsQuery } from '../routes/notifications.schemas';

// ---------------------------------------------------------------- the worker side

// Statuses where a reminder still makes sense.
const UPCOMING = ['PENDING', 'CONFIRMED', 'ASSIGNED'];

// Runs one notification job: load the CURRENT facts, decide who is told what, save the in-app rows, send the emails.
// Safe to run twice (a retry): rows are found by their de-dupe key and an email is only sent while emailedAt is empty.
export async function processNotification(job: NotifyJob, now = new Date()): Promise<{ skipped?: string; saved: number; emailed: number }> {
  const managers = await prisma.user.findMany({
    where: { role: { in: ['OWNER', 'MANAGER'] }, active: true },
    select: { id: true, name: true, email: true },
  });

  let ctx: BuildCtx;
  if (job.bookingId) {
    const booking = await prisma.booking.findUnique({
      where: { id: job.bookingId },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } },
        service: { select: { name: true, basePrice: true } },
        appliance: { select: { brand: true, category: { select: { name: true } } } },
        address: { select: { area: true } },
        technician: { select: { user: { select: { id: true, name: true, email: true } } } },
        visit: true,
      },
    });
    if (!booking) return { skipped: 'booking not found', saved: 0, emailed: 0 };

    // Scheduled jobs wake up later: skip them if the booking moved, ended, or is not in the state they were made for.
    if (job.expectStartAt && booking.startAt.toISOString() !== job.expectStartAt) return { skipped: 'booking was rescheduled', saved: 0, emailed: 0 };
    if ((job.type === 'REMINDER_24H' || job.type === 'REMINDER_2H') && !UPCOMING.includes(booking.status)) return { skipped: `booking is ${booking.status}`, saved: 0, emailed: 0 };
    if (job.requireStatus && booking.status !== job.requireStatus) return { skipped: `booking is ${booking.status}`, saved: 0, emailed: 0 };

    // The technician the event is about: usually the current one; for JOB_REMOVED the one who lost the job.
    const techUser =
      job.type === 'JOB_REMOVED' && job.technicianId
        ? (await prisma.technician.findUnique({ where: { id: job.technicianId }, select: { user: { select: { id: true, name: true, email: true } } } }))?.user
        : booking.technician?.user;

    ctx = {
      frontendUrl: env.FRONTEND_URL,
      booking: {
        id: booking.id,
        bookingNumber: booking.bookingNumber,
        startAt: booking.startAt,
        serviceName: booking.service.name,
        applianceName: `${booking.appliance.brand} ${booking.appliance.category.name}`,
        area: booking.address.area,
      },
      customer: booking.customer,
      technician: techUser ?? null,
      managers,
      previousStartAt: job.previousStartAt ? new Date(job.previousStartAt) : undefined,
      decision: job.decision,
      at: job.at,
      extra: booking.visit?.extraChargeAmount ? { amount: booking.visit.extraChargeAmount.toFixed(2), reason: booking.visit.extraChargeReason } : undefined,
      total: booking.status === 'COMPLETED' || job.type === 'VISIT_COMPLETED' ? amountDue(booking.visit, booking.service.basePrice).toFixed(2) : undefined,
    };
  } else {
    // Not about one booking (NEEDS_REASSIGNMENT): only the managers matter.
    ctx = {
      frontendUrl: env.FRONTEND_URL,
      booking: { id: '', bookingNumber: '', startAt: now, serviceName: '', applianceName: '', area: '' },
      customer: { id: '', name: '', email: null, phone: null },
      technician: null,
      managers,
      count: job.count,
      technicianName: job.technicianName,
      timeOffId: job.timeOffId,
      at: job.at,
    };
  }

  const messages = buildMessages(job.type, ctx);
  let emailed = 0;
  const failures: Error[] = [];

  for (const m of messages) {
    const row = await prisma.notification.upsert({
      where: { dedupeKey: m.dedupeKey },
      update: {},
      create: { userId: m.userId, type: m.type, message: m.message, bookingId: m.bookingId, dedupeKey: m.dedupeKey },
    });
    if (!m.email || row.emailedAt) continue; // in-app only, or already emailed on an earlier try
    try {
      await mailer.send({ to: m.email, subject: m.subject, text: m.body });
      await prisma.notification.update({ where: { id: row.id }, data: { emailedAt: now } });
      emailed++;
    } catch (err) {
      logger.error({ err, notificationId: row.id, type: m.type }, 'Notification email failed');
      failures.push(err as Error);
    }
  }
  // Throwing makes the queue retry the job later, with backoff. Rows already saved and emails already sent are skipped then.
  if (failures.length > 0) throw new Error(`${failures.length} email(s) failed: ${failures[0].message}`);
  return { saved: messages.length, emailed };
}

// ---------------------------------------------------------------- the API side (a person reads their own)

const view = (n: { id: string; type: string; message: string; bookingId: string | null; readAt: Date | null; createdAt: Date }) => ({
  id: n.id,
  type: n.type,
  message: n.message,
  bookingId: n.bookingId,
  read: n.readAt !== null,
  createdAt: n.createdAt,
});

export async function listNotifications(userId: string, q: ListNotificationsQuery) {
  const where: Prisma.NotificationWhereInput = { userId, ...(q.unread && { readAt: null }) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { ...toPage(items.map(view), total, q), unread };
}

export async function unreadCount(userId: string) {
  return { unread: await prisma.notification.count({ where: { userId, readAt: null } }) };
}

export async function markRead(userId: string, id: string) {
  // Scoped by user: nobody can mark (or probe) someone else's notification.
  const { count } = await prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  if (count === 0 && !(await prisma.notification.findFirst({ where: { id, userId }, select: { id: true } }))) {
    throw AppError.notFound('Notification not found');
  }
  return unreadCount(userId);
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  return { unread: 0 };
}
