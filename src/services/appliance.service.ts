import type { Appliance, ServiceCategory } from '@prisma/client';
import { prisma } from '../db/prisma';
import { pageArgs, toPage } from '../db/paginate';
import { AppError } from '../errors/AppError';
import { assertOwnsRecord, resolveCustomerId } from './customer-access.service';
import type { CreateApplianceBody, ListAppliancesQuery, UpdateApplianceBody } from '../routes/appliances.schemas';

type Actor = Express.Request['user'] & {};

const publicAppliance = (a: Appliance & { category: ServiceCategory }) => ({
  id: a.id,
  customerId: a.customerId,
  category: { id: a.category.id, name: a.category.name },
  brand: a.brand,
  model: a.model,
  serialNumber: a.serialNumber,
  purchaseYear: a.purchaseYear,
  description: a.description,
});

// "This year" in the business timezone, not the server's (servers usually run in UTC).
const currentYearIST = () => Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(new Date()));

async function checkFields(input: { categoryId?: string; purchaseYear?: number | null }) {
  if (input.purchaseYear && input.purchaseYear > currentYearIST()) {
    throw AppError.badRequest('Purchase year is in the future', [{ path: 'purchaseYear', message: 'Cannot be in the future' }]);
  }
  if (input.categoryId && !(await prisma.serviceCategory.findUnique({ where: { id: input.categoryId } }))) {
    throw AppError.badRequest('Category does not exist', [{ path: 'categoryId', message: 'Unknown category' }]);
  }
}

export async function listAppliances(actor: Actor, q: ListAppliancesQuery) {
  const customerId = await resolveCustomerId(actor, q.customerId);
  const where = { customerId };
  const [items, total] = await Promise.all([
    prisma.appliance.findMany({ where, include: { category: true }, orderBy: { createdAt: 'asc' }, ...pageArgs(q) }),
    prisma.appliance.count({ where }),
  ]);
  return toPage(items.map(publicAppliance), total, q);
}

export async function createAppliance(actor: Actor, input: CreateApplianceBody) {
  const { customerId: requested, ...data } = input;
  const customerId = await resolveCustomerId(actor, requested);
  await checkFields(data);
  const a = await prisma.appliance.create({ data: { ...data, customerId }, include: { category: true } });
  return publicAppliance(a);
}

async function load(actor: Actor, id: string) {
  return assertOwnsRecord(actor, await prisma.appliance.findUnique({ where: { id } }), 'Appliance');
}

export async function updateAppliance(actor: Actor, id: string, input: UpdateApplianceBody) {
  await load(actor, id);
  await checkFields(input);
  const a = await prisma.appliance.update({ where: { id }, data: input, include: { category: true } });
  return publicAppliance(a);
}

export async function deleteAppliance(actor: Actor, id: string) {
  await load(actor, id);
  if (await prisma.booking.count({ where: { applianceId: id } })) {
    throw AppError.conflict('This appliance has bookings and cannot be deleted', 'IN_USE');
  }
  await prisma.appliance.delete({ where: { id } });
}
