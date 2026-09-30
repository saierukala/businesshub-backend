import type { Prisma, Role, Service, ServiceCategory } from '@prisma/client';
import { prisma } from '../db/prisma';
import { pageArgs, toPage, type PageInput } from '../db/paginate';
import { AppError } from '../errors/AppError';
import { isStaff } from '../middleware/auth';
import type { CreateServiceBody, ListServicesQuery, UpdateServiceBody } from '../routes/catalog.schemas';

// ---------- Categories ----------

export async function listCategories(page: PageInput) {
  const [items, total] = await Promise.all([
    prisma.serviceCategory.findMany({ orderBy: { name: 'asc' }, ...pageArgs(page) }),
    prisma.serviceCategory.count(),
  ]);
  return toPage(items.map(publicCategory), total, page);
}

export async function createCategory(name: string) {
  return publicCategory(await prisma.serviceCategory.create({ data: { name } }));
}

export async function renameCategory(id: string, name: string) {
  return publicCategory(await prisma.serviceCategory.update({ where: { id }, data: { name } }));
}

const publicCategory = (c: ServiceCategory) => ({ id: c.id, name: c.name });

// ---------- Services ----------

type ServiceWithCategory = Service & { category: ServiceCategory };

// Money leaves the API as a string with 2 decimals ("499.00"): no float rounding surprises.
function publicService(s: ServiceWithCategory) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    durationMinutes: s.durationMinutes,
    basePrice: s.basePrice.toFixed(2),
    active: s.active,
    category: publicCategory(s.category),
  };
}

export async function listServices(role: Role, q: ListServicesQuery) {
  // Customers and technicians only ever see active services.
  const showInactive = isStaff(role) && q.includeInactive === true;
  const where: Prisma.ServiceWhereInput = {
    categoryId: q.categoryId,
    ...(showInactive ? {} : { active: true }),
  };
  const [items, total] = await Promise.all([
    prisma.service.findMany({ where, include: { category: true }, orderBy: { name: 'asc' }, ...pageArgs(q) }),
    prisma.service.count({ where }),
  ]);
  return toPage(items.map(publicService), total, q);
}

export async function getService(role: Role, id: string) {
  const s = await prisma.service.findUnique({ where: { id }, include: { category: true } });
  if (!s || (!s.active && !isStaff(role))) throw AppError.notFound('Service not found');
  return publicService(s);
}

async function assertCategory(categoryId: string | undefined) {
  if (categoryId && !(await prisma.serviceCategory.findUnique({ where: { id: categoryId } }))) {
    throw AppError.badRequest('Category does not exist', [{ path: 'categoryId', message: 'Unknown category' }]);
  }
}

export async function createService(input: CreateServiceBody) {
  await assertCategory(input.categoryId);
  const s = await prisma.service.create({ data: input, include: { category: true } });
  return publicService(s);
}

// Deactivate with { active: false }. Services are never deleted: old bookings point at them.
export async function updateService(id: string, input: UpdateServiceBody) {
  await assertCategory(input.categoryId);
  const s = await prisma.service.update({ where: { id }, data: input, include: { category: true } });
  return publicService(s);
}
