import type { Prisma, User } from '@prisma/client';
import { prisma } from '../db/prisma';
import { pageArgs, toPage } from '../db/paginate';
import { AppError } from '../errors/AppError';
import { writeAudit } from './audit.service';
import { sendAccountInvite } from './auth.service';
import type { CreateUserBody, ListUsersQuery } from '../routes/users.schemas';

// Owner-facing view. hasAccount = has set a password (accepted the invite / registered).
const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  active: u.active,
  hasAccount: u.passwordHash !== null,
  createdAt: u.createdAt,
});

export async function listUsers(q: ListUsersQuery) {
  const where: Prisma.UserWhereInput = { role: q.role, active: q.active };
  if (q.q) {
    where.OR = [
      { name: { contains: q.q, mode: 'insensitive' } },
      { email: { contains: q.q, mode: 'insensitive' } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: [{ role: 'asc' }, { name: 'asc' }], ...pageArgs(q) }),
    prisma.user.count({ where }),
  ]);
  return toPage(items.map(publicUser), total, q);
}

export async function createUser(ownerId: string, input: CreateUserBody) {
  if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
    throw new AppError(409, 'EMAIL_TAKEN', 'This email is already used by another account', [
      { path: 'email', message: 'Already used by another account' },
    ]);
  }
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { ...input, createdByUserId: ownerId, passwordHash: null },
    });
    // Skills, areas and working hours are set up in Phase 4 (technician screens).
    if (u.role === 'TECHNICIAN') await tx.technician.create({ data: { userId: u.id, phone: input.phone } });
    await writeAudit({ userId: ownerId, action: 'USER_CREATED', entityType: 'User', entityId: u.id, metadata: { role: u.role } }, tx);
    return u;
  });
  // After the transaction: if the email fails, the account still exists and the owner can resend.
  await sendAccountInvite(user);
  return publicUser(user);
}

export async function setActive(ownerId: string, id: string, active: boolean) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw AppError.notFound('User not found');
  if (user.id === ownerId) throw AppError.badRequest('You cannot deactivate your own account');
  if (user.role === 'OWNER') throw AppError.forbidden('Owner accounts cannot be deactivated here');
  if (user.active === active) return publicUser(user);

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id }, data: { active } });
    // Keep the technician record in step, so availability (Phase 5) skips inactive technicians.
    if (u.role === 'TECHNICIAN') {
      await tx.technician.update({ where: { userId: id }, data: { status: active ? 'ACTIVE' : 'INACTIVE' } });
    }
    await writeAudit(
      { userId: ownerId, action: active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', entityType: 'User', entityId: id, metadata: { role: u.role } },
      tx,
    );
    return u;
  });
  // Their session stops working on the next request: requireAuth checks `active` every time.
  return publicUser(updated);
}

export async function resendInvite(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role === 'CUSTOMER' || user.role === 'OWNER') throw AppError.notFound('Staff member not found');
  if (!user.active) throw AppError.conflict('This account is deactivated', 'ACCOUNT_DISABLED');
  if (user.passwordHash) throw AppError.conflict('This person has already set a password', 'ALREADY_REGISTERED');
  await sendAccountInvite(user);
}
