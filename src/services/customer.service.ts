import type { Prisma, User } from '@prisma/client';
import { prisma } from '../db/prisma';
import { pageArgs, toPage } from '../db/paginate';
import { AppError } from '../errors/AppError';
import { writeAudit } from './audit.service';
import type { CreateCustomerBody, ListCustomersQuery, UpdateCustomerBody } from '../routes/customers.schemas';

// Staff-facing view of a customer. hasAccount = has set a password (can log in online).
export const publicCustomer = (u: User) => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  email: u.email,
  emailVerified: u.emailVerifiedAt !== null,
  hasAccount: u.passwordHash !== null,
  active: u.active,
  createdAt: u.createdAt,
});

export async function searchCustomers(q: ListCustomersQuery) {
  const where: Prisma.UserWhereInput = { role: 'CUSTOMER' };
  if (q.q) {
    const digits = q.q.replace(/\D/g, '');
    where.OR = [
      { name: { contains: q.q, mode: 'insensitive' } },
      { email: { contains: q.q, mode: 'insensitive' } },
      // Phones are stored as 10 digits, so search by the digits the user typed.
      ...(digits.length >= 3 ? [{ phone: { contains: digits.slice(-10) } }] : []),
    ];
  }
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { name: 'asc' }, ...pageArgs(q) }),
    prisma.user.count({ where }),
  ]);
  return toPage(items.map(publicCustomer), total, q);
}

export async function getCustomer(id: string) {
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u || u.role !== 'CUSTOMER') throw AppError.notFound('Customer not found');
  return publicCustomer(u);
}

// Spec: warn (not block) on duplicate phone. The 409 lists the matches so staff can pick
// the existing customer instead of creating a second record for the same person.
async function checkDuplicatePhone(phone: string, allow: boolean, exceptId?: string) {
  if (allow) return;
  const matches = await prisma.user.findMany({
    where: { role: 'CUSTOMER', phone, id: exceptId ? { not: exceptId } : undefined },
    select: { id: true, name: true, phone: true, email: true },
    take: 5,
  });
  if (matches.length) {
    throw new AppError(409, 'DUPLICATE_PHONE', 'A customer with this phone number already exists', matches);
  }
}

async function checkEmailFree(email: string | null | undefined, exceptId?: string) {
  if (!email) return;
  const other = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (other && other.id !== exceptId) {
    throw new AppError(409, 'EMAIL_TAKEN', 'This email is already used by another account', [
      { path: 'email', message: 'Already used by another account' },
    ]);
  }
}

export async function createCustomer(actorId: string, input: CreateCustomerBody) {
  await checkDuplicatePhone(input.phone, input.allowDuplicatePhone);
  await checkEmailFree(input.email);

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        name: input.name,
        phone: input.phone,
        email: input.email ?? null,
        role: 'CUSTOMER', // no password: phone-only until they accept an invite
        createdByUserId: actorId,
      },
    });
    await writeAudit(
      { userId: actorId, action: 'CUSTOMER_CREATED', entityType: 'User', entityId: u.id, metadata: { duplicatePhoneConfirmed: input.allowDuplicatePhone } },
      tx,
    );
    return u;
  });
  return publicCustomer(user);
}

export async function updateCustomer(actorId: string, id: string, input: UpdateCustomerBody) {
  const before = await prisma.user.findUnique({ where: { id } });
  if (!before || before.role !== 'CUSTOMER') throw AppError.notFound('Customer not found');

  const { allowDuplicatePhone, ...changes } = input;
  if (changes.phone && changes.phone !== before.phone) await checkDuplicatePhone(changes.phone, allowDuplicatePhone, id);
  const emailChanged = changes.email !== undefined && changes.email !== before.email;
  if (emailChanged) await checkEmailFree(changes.email, id);
  if (emailChanged && changes.email === null && before.passwordHash) {
    // Email is their login: removing it would lock them out of their account.
    throw AppError.badRequest('This customer logs in with their email, so it cannot be removed', [
      { path: 'email', message: 'Required for customers with an online account' },
    ]);
  }

  // Record only the fields that really changed, old -> new.
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(changes)) {
    const from = before[key as keyof typeof changes];
    if (to !== undefined && to !== from) diff[key] = { from, to };
  }
  if (Object.keys(diff).length === 0) return publicCustomer(before);

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id },
      // A new email is unproven until the customer clicks a link sent to it.
      data: { ...changes, ...(emailChanged ? { emailVerifiedAt: null } : {}) },
    });
    if (emailChanged) {
      // Links already sent to the old address must stop working: if the old email was
      // wrong (someone else's inbox), that person could otherwise claim this account.
      await tx.authToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
    }
    await writeAudit({ userId: actorId, action: 'CUSTOMER_UPDATED', entityType: 'User', entityId: id, metadata: diff as Prisma.InputJsonValue }, tx);
    return u;
  });
  return publicCustomer(user);
}
