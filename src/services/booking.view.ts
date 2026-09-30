import type { Prisma, Role } from '@prisma/client';

// What we load for a booking, and how it is shown. Customers get the same fields as staff,
// minus who changed a status.
export const bookingInclude = {
  customer: { select: { id: true, name: true, phone: true, email: true } },
  service: { select: { id: true, name: true, durationMinutes: true, basePrice: true } },
  appliance: { select: { id: true, brand: true, model: true, category: { select: { id: true, name: true } } } },
  address: { select: { id: true, label: true, line1: true, area: true, city: true, pincode: true } },
  technician: { select: { id: true, user: { select: { name: true } } } },
} satisfies Prisma.BookingInclude;

export const historyInclude = {
  statusHistory: {
    orderBy: { createdAt: 'asc' },
    include: { changedBy: { select: { name: true, role: true } } },
  },
} satisfies Prisma.BookingInclude;

type Loaded = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;
type WithHistory = Prisma.BookingGetPayload<{ include: typeof bookingInclude & typeof historyInclude }>;

export function bookingView(b: Loaded) {
  return {
    id: b.id,
    bookingNumber: b.bookingNumber,
    status: b.status,
    source: b.source,
    startAt: b.startAt,
    endAt: b.endAt,
    problemDescription: b.problemDescription,
    rescheduleCount: b.rescheduleCount,
    needsReassignment: b.needsReassignment,
    createdByUserId: b.createdByUserId,
    createdAt: b.createdAt,
    customer: b.customer,
    service: { ...b.service, basePrice: b.service.basePrice.toFixed(2) },
    appliance: b.appliance,
    address: b.address,
    technician: b.technician ? { id: b.technician.id, name: b.technician.user.name } : null,
  };
}

export function bookingDetailView(b: WithHistory, viewerRole: Role) {
  const staff = viewerRole === 'OWNER' || viewerRole === 'MANAGER';
  return {
    ...bookingView(b),
    history: b.statusHistory.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      note: h.note,
      createdAt: h.createdAt,
      ...(staff && { changedBy: h.changedBy }),
    })),
  };
}
