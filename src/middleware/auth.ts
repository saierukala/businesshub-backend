import type { RequestHandler } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../db/prisma';
import { AppError } from '../errors/AppError';
import { SESSION_COOKIE, readSession } from '../auth/session';

// Checks the session cookie and loads the user from the database on every request,
// so deactivating a user or changing their role takes effect immediately.
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const session = readSession(req.cookies?.[SESSION_COOKIE]);
  if (!session) return next(AppError.unauthorized());

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { id: true, role: true, active: true, passwordChangedAt: true },
  });
  if (!user || !user.active) return next(AppError.unauthorized());

  // Sessions created before the last password change are no longer valid.
  if (user.passwordChangedAt && session.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
    return next(AppError.unauthorized('Session expired, please log in again'));
  }

  req.user = { id: user.id, role: user.role };
  next();
};

// Usage: router.get('/x', requireAuth, requireRole('OWNER', 'MANAGER'), handler)
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) return next(AppError.forbidden());
    next();
  };

export const isStaff = (role: Role) => role === 'OWNER' || role === 'MANAGER';

// Ownership check for customer-owned records (addresses, appliances, bookings...).
// Staff may access any customer; a customer only their own. Technician access is by
// assigned booking and is checked in those services (Phase 6+).
// Returns 404 (not 403) to a customer so they cannot probe which ids exist.
export function assertCustomerAccess(user: Express.Request['user'], customerId: string) {
  if (!user) throw AppError.unauthorized();
  if (isStaff(user.role)) return;
  if (user.role === 'CUSTOMER' && user.id === customerId) return;
  throw user.role === 'CUSTOMER' ? AppError.notFound() : AppError.forbidden();
}
