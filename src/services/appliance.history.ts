import { prisma } from '../db/prisma';
import { pageArgs, toPage, type PageInput } from '../db/paginate';
import { assertOwnsRecord } from './customer-access.service';
import { visitView } from './booking.view';
import type { Actor } from './booking.shared';

// Service history of one appliance (spec §10): its COMPLETED visits, newest first, with the date, service,
// amount and technician. A follow-up shows which earlier booking it continues.
// A customer sees their own appliances; Owner/Manager see any.
export async function applianceHistory(actor: Actor, applianceId: string, q: PageInput) {
  assertOwnsRecord(actor, await prisma.appliance.findUnique({ where: { id: applianceId } }), 'Appliance');

  const where = { applianceId, status: 'COMPLETED' as const };
  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: { startAt: 'desc' },
      ...pageArgs(q),
      include: {
        service: { select: { id: true, name: true, basePrice: true } },
        technician: { select: { user: { select: { name: true } } } },
        followUpOf: { select: { id: true, bookingNumber: true } },
        visit: true,
      },
    }),
    prisma.booking.count({ where }),
  ]);

  const items = rows.map((b) => {
    const visit = visitView(b.visit, b.service.basePrice);
    return {
      bookingId: b.id,
      bookingNumber: b.bookingNumber,
      date: b.startAt,
      service: { id: b.service.id, name: b.service.name },
      technician: b.technician?.user.name ?? null,
      diagnosis: visit?.diagnosis ?? null,
      workPerformed: visit?.workPerformed ?? null,
      amount: visit?.finalAmount ?? b.service.basePrice.toFixed(2), // base price + approved extra charge
      followUpOf: b.followUpOf,
    };
  });
  return toPage(items, total, q);
}
