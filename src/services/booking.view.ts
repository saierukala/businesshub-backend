import type { Payment, Prisma, Role, ServiceVisit } from '@prisma/client';

// What we load for a booking, and how it is shown. Customers get the same fields as staff,
// minus who changed a status.
export const bookingInclude = {
  customer: { select: { id: true, name: true, phone: true, email: true } },
  service: { select: { id: true, name: true, durationMinutes: true, basePrice: true } },
  appliance: { select: { id: true, brand: true, model: true, category: { select: { id: true, name: true } } } },
  address: { select: { id: true, label: true, line1: true, area: true, city: true, pincode: true } },
  technician: { select: { id: true, user: { select: { name: true } } } },
  payments: { where: { status: 'PAID' }, select: { id: true }, take: 1 }, // only to tell whether it is paid
} satisfies Prisma.BookingInclude;

export const historyInclude = {
  followUpOf: { select: { id: true, bookingNumber: true } },
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
    paid: b.payments.length > 0,
    createdByUserId: b.createdByUserId,
    createdAt: b.createdAt,
    customer: b.customer,
    service: { ...b.service, basePrice: b.service.basePrice.toFixed(2) },
    appliance: b.appliance,
    address: b.address,
    technician: b.technician ? { id: b.technician.id, name: b.technician.user.name } : null,
  };
}

const money = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(2));

// The amount to collect: the service's base price + the extra charge only if the customer approved it (spec §10).
// The ONE place this is worked out; the visit report and the payment both use it.
export function amountDue(v: ServiceVisit | null, basePrice: Prisma.Decimal): Prisma.Decimal {
  const extra = v && v.extraChargeStatus === 'APPROVED' && v.extraChargeAmount ? v.extraChargeAmount : 0;
  return basePrice.add(extra);
}

// What happened at the visit. finalAmount = the service's base price + the extra charge IF it was approved
// (spec §10). It is only ever computed here, on the server.
export function visitView(v: ServiceVisit | null, basePrice: Prisma.Decimal) {
  if (!v) return null;
  return {
    startedAt: v.startedAt,
    completedAt: v.completedAt,
    diagnosis: v.diagnosis,
    workPerformed: v.workPerformed,
    partsNote: v.partsNote,
    notes: v.notes,
    result: v.result,
    extraCharge: {
      status: v.extraChargeStatus,
      amount: money(v.extraChargeAmount),
      reason: v.extraChargeReason,
      decidedAt: v.extraChargeDecidedAt,
    },
    finalAmount: amountDue(v, basePrice).toFixed(2),
  };
}

type PaymentWithUser = Payment & { recordedBy: { name: string } | null };

// A recorded payment. The amount is what the server worked out; a client never sends it.
export function paymentView(p: PaymentWithUser | null) {
  if (!p) return null;
  return {
    id: p.id,
    amount: p.amount.toFixed(2),
    method: p.method,
    status: p.status,
    reference: p.providerRef,
    receiptNumber: p.receiptNumber,
    paidAt: p.paidAt,
    recordedBy: p.recordedBy?.name ?? null,
  };
}

export function bookingDetailView(b: WithHistory, viewerRole: Role, visit: ServiceVisit | null = null, payment: PaymentWithUser | null = null) {
  const staff = viewerRole === 'OWNER' || viewerRole === 'MANAGER';
  return {
    ...bookingView(b),
    followUpOf: b.followUpOf ? { id: b.followUpOf.id, bookingNumber: b.followUpOf.bookingNumber } : null,
    visit: visitView(visit, b.service.basePrice),
    payment: paymentView(payment),
    history: b.statusHistory.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      note: h.note,
      createdAt: h.createdAt,
      ...(staff && { changedBy: h.changedBy }),
    })),
  };
}
