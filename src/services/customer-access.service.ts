import { prisma } from '../db/prisma';
import { AppError } from '../errors/AppError';
import { assertCustomerAccess, isStaff } from '../middleware/auth';

type Actor = { id: string; role: import('@prisma/client').Role };

// Which customer is this request acting for?
// - Customer: always themselves. Any customerId they send is ignored (spec rule 3).
// - Owner/Manager: must name the customer, and it must be a real customer.
// - Technician: no access to customer records here.
export async function resolveCustomerId(actor: Actor, requestedId: string | undefined): Promise<string> {
  if (actor.role === 'CUSTOMER') return actor.id;
  if (!isStaff(actor.role)) throw AppError.forbidden();
  if (!requestedId) {
    throw AppError.badRequest('customerId is required', [{ path: 'customerId', message: 'Choose a customer' }]);
  }
  const customer = await prisma.user.findUnique({ where: { id: requestedId }, select: { role: true } });
  if (!customer || customer.role !== 'CUSTOMER') throw AppError.notFound('Customer not found');
  return requestedId;
}

// For records looked up by id (address, appliance): 404 if missing, then the ownership check.
export function assertOwnsRecord<T extends { customerId: string }>(actor: Actor, record: T | null, label: string): T {
  if (!record) throw AppError.notFound(`${label} not found`);
  if (actor.role === 'TECHNICIAN') throw AppError.forbidden();
  try {
    assertCustomerAccess(actor, record.customerId);
  } catch (err) {
    // Same message as "missing", so a customer can't tell another customer's id exists.
    if (err instanceof AppError && err.statusCode === 404) throw AppError.notFound(`${label} not found`);
    throw err;
  }
  return record;
}
