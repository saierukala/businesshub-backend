import type { Address } from '@prisma/client';
import { prisma } from '../db/prisma';
import { pageArgs, toPage } from '../db/paginate';
import { AppError } from '../errors/AppError';
import { assertOwnsRecord, resolveCustomerId } from './customer-access.service';
import type { CreateAddressBody, ListAddressesQuery, UpdateAddressBody } from '../routes/addresses.schemas';

type Actor = Express.Request['user'] & {};

const publicAddress = (a: Address) => ({
  id: a.id,
  customerId: a.customerId,
  label: a.label,
  line1: a.line1,
  area: a.area,
  city: a.city,
  pincode: a.pincode,
});

export async function listAddresses(actor: Actor, q: ListAddressesQuery) {
  const customerId = await resolveCustomerId(actor, q.customerId);
  const where = { customerId };
  const [items, total] = await Promise.all([
    prisma.address.findMany({ where, orderBy: { createdAt: 'asc' }, ...pageArgs(q) }),
    prisma.address.count({ where }),
  ]);
  return toPage(items.map(publicAddress), total, q);
}

export async function createAddress(actor: Actor, input: CreateAddressBody) {
  const { customerId: requested, ...data } = input;
  const customerId = await resolveCustomerId(actor, requested);
  return publicAddress(await prisma.address.create({ data: { ...data, customerId } }));
}

async function load(actor: Actor, id: string) {
  return assertOwnsRecord(actor, await prisma.address.findUnique({ where: { id } }), 'Address');
}

export async function updateAddress(actor: Actor, id: string, input: UpdateAddressBody) {
  await load(actor, id);
  // Past bookings keep pointing at this row, so editing changes where old visits "were".
  // Fine for fixing typos; for a move, add a new address instead (the UI says so).
  return publicAddress(await prisma.address.update({ where: { id }, data: input }));
}

export async function deleteAddress(actor: Actor, id: string) {
  await load(actor, id);
  if (await prisma.booking.count({ where: { addressId: id } })) {
    throw AppError.conflict('This address is used by a booking and cannot be deleted', 'IN_USE');
  }
  await prisma.address.delete({ where: { id } });
}
