import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';
import { createUser } from './db';
import { loginAs } from './http';

// A Monday at least 3 days ahead (and within 30): the cutoff never interferes with real-clock tests.
export const monday = (() => {
  let d = DateTime.now().setZone('Asia/Kolkata').startOf('day').plus({ days: 3 });
  while (d.weekday !== 1) d = d.plus({ days: 1 });
  return d;
})();
export const date = monday.toFormat('yyyy-MM-dd');

// "10:30" on that Monday, in IST. dayOffset moves to another day (7 = the next Monday).
export const at = (hhmm: string, dayOffset = 0) =>
  DateTime.fromFormat(`${monday.plus({ days: dayOffset }).toFormat('yyyy-MM-dd')} ${hhmm}`, 'yyyy-MM-dd HH:mm', { zone: 'Asia/Kolkata' }).toJSDate();

// Booking test data: one appliance category and service (60 min), `techCount` technicians who all
// cover Kondapur Mon-Sat 09:00-18:00, and a first customer with an address and appliance.
export async function makeWorld(techCount = 1) {
  const categoryId = (await prisma.serviceCategory.create({ data: { name: 'Refrigerator' } })).id;
  const serviceId = (await prisma.service.create({ data: { categoryId, name: 'Fridge Repair', durationMinutes: 60, basePrice: 599 } })).id;

  const techs: { id: string; userId: string }[] = [];
  for (let i = 0; i < techCount; i++) {
    const user = await createUser('TECHNICIAN');
    const tech = await prisma.technician.create({
      data: {
        userId: user.id,
        phone: `900000000${i + 1}`,
        skills: { create: [{ categoryId }] },
        areas: { create: [{ area: 'Kondapur' }] },
        workingHours: {
          create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '18:00', isOff: dayOfWeek === 0 })),
        },
      },
    });
    techs.push({ id: tech.id, userId: user.id });
  }

  // A customer who can log in, with their own address and appliance.
  async function addCustomer() {
    const user = await createUser('CUSTOMER');
    const address = await prisma.address.create({
      data: { customerId: user.id, label: 'Home', line1: 'Flat 1, Sunrise Apartments', area: 'Kondapur', city: 'Hyderabad' },
    });
    const appliance = await prisma.appliance.create({ data: { customerId: user.id, categoryId, brand: 'LG' } });
    return { user, addressId: address.id, applianceId: appliance.id, agent: await loginAs(user.email!) };
  }

  return { categoryId, serviceId, techs, addCustomer, customer: await addCustomer() };
}
export type World = Awaited<ReturnType<typeof makeWorld>>;

// Request body for POST /bookings as a customer would send it.
export const bookingBody = (w: World, hhmm: string, c: { applianceId: string; addressId: string } = w.customer) => ({
  applianceId: c.applianceId,
  serviceId: w.serviceId,
  addressId: c.addressId,
  problemDescription: 'Not cooling',
  startAt: at(hhmm).toISOString(),
});
