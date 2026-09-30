/* Demo seed for HomeFix Appliance Services. Safe to run more than once (idempotent).
 * DEV/DEMO ONLY: every demo account uses the same well-known password. */
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'Password@123';

const CATEGORIES = [
  'Washing Machine',
  'Refrigerator',
  'Air Conditioner',
  'Microwave',
  'Dishwasher',
  'Water Purifier',
  'TV',
];

// Prices/durations for the first three come from the spec; the rest are sensible demo values.
const SERVICES = [
  { category: 'Washing Machine', name: 'Washing Machine Repair', durationMinutes: 60, basePrice: 499 },
  { category: 'Refrigerator', name: 'Refrigerator Repair', durationMinutes: 90, basePrice: 599 },
  { category: 'Air Conditioner', name: 'AC Repair', durationMinutes: 90, basePrice: 699 },
  { category: 'Microwave', name: 'Microwave Repair', durationMinutes: 60, basePrice: 399 },
  { category: 'Dishwasher', name: 'Dishwasher Repair', durationMinutes: 60, basePrice: 549 },
  { category: 'Water Purifier', name: 'Water Purifier Repair', durationMinutes: 45, basePrice: 349 },
  { category: 'TV', name: 'TV Repair', durationMinutes: 60, basePrice: 449 },
];

const TECHNICIANS = [
  {
    name: 'Rahul Sharma',
    email: 'rahul@homefix.test',
    phone: '9000000001',
    skills: ['Washing Machine', 'Refrigerator', 'Dishwasher'],
    areas: ['Kondapur', 'Madhapur', 'Gachibowli'],
  },
  {
    name: 'Arjun Reddy',
    email: 'arjun@homefix.test',
    phone: '9000000002',
    skills: ['Air Conditioner', 'Microwave', 'TV'],
    areas: ['Kondapur', 'Gachibowli', 'Hitec City'],
  },
  {
    name: 'Suresh Kumar',
    email: 'suresh@homefix.test',
    phone: '9000000003',
    skills: ['Washing Machine', 'Refrigerator', 'Water Purifier'],
    areas: ['Madhapur', 'Kondapur'],
  },
];

async function upsertUser(email: string, name: string, phone: string, role: Role, passwordHash: string) {
  return prisma.user.upsert({
    where: { email },
    update: { name, phone, role, active: true },
    create: { email, name, phone, role, passwordHash, emailVerifiedAt: new Date() },
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO !== 'true') {
    console.error('Refusing to seed demo data in production. Set SEED_DEMO=true to override.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // Business settings (single row)
  await prisma.businessSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  // Categories and services
  const categoryId = new Map<string, string>();
  for (const name of CATEGORIES) {
    const c = await prisma.serviceCategory.upsert({ where: { name }, update: {}, create: { name } });
    categoryId.set(name, c.id);
  }
  for (const s of SERVICES) {
    await prisma.service.upsert({
      where: { name: s.name },
      update: { durationMinutes: s.durationMinutes, basePrice: s.basePrice },
      create: {
        name: s.name,
        categoryId: categoryId.get(s.category)!,
        durationMinutes: s.durationMinutes,
        basePrice: s.basePrice,
      },
    });
  }

  // Staff
  const owner = await upsertUser('owner@homefix.test', 'Anita Rao', '9000000100', Role.OWNER, passwordHash);
  const manager = await upsertUser('manager@homefix.test', 'Vikram Singh', '9000000101', Role.MANAGER, passwordHash);

  // Technicians: skills, service areas, Mon-Sat 09:00-18:00, Sunday off
  for (const t of TECHNICIANS) {
    const user = await upsertUser(t.email, t.name, t.phone, Role.TECHNICIAN, passwordHash);
    const tech = await prisma.technician.upsert({
      where: { userId: user.id },
      update: { phone: t.phone },
      create: { userId: user.id, phone: t.phone },
    });

    await prisma.technicianSkill.createMany({
      data: t.skills.map((s) => ({ technicianId: tech.id, categoryId: categoryId.get(s)! })),
      skipDuplicates: true,
    });
    await prisma.technicianServiceArea.createMany({
      data: t.areas.map((area) => ({ technicianId: tech.id, area })),
      skipDuplicates: true,
    });
    for (let day = 0; day <= 6; day++) {
      const isOff = day === 0; // Sunday
      await prisma.workingHours.upsert({
        where: { technicianId_dayOfWeek: { technicianId: tech.id, dayOfWeek: day } },
        update: {},
        create: { technicianId: tech.id, dayOfWeek: day, startTime: '09:00', endTime: '18:00', isOff },
      });
    }
  }

  // Customer with login: Ravi Kumar (demo scenario A)
  const ravi = await upsertUser('ravi@example.test', 'Ravi Kumar', '9000000010', Role.CUSTOMER, passwordHash);
  const raviAddress =
    (await prisma.address.findFirst({ where: { customerId: ravi.id, area: 'Kondapur' } })) ??
    (await prisma.address.create({
      data: { customerId: ravi.id, label: 'Home', line1: 'Flat 302, Sunrise Apartments', area: 'Kondapur', pincode: '500084' },
    }));
  const existingAppliance = await prisma.appliance.findFirst({ where: { serialNumber: 'LG123456789' } });
  if (!existingAppliance) {
    await prisma.appliance.create({
      data: {
        customerId: ravi.id,
        categoryId: categoryId.get('Washing Machine')!,
        brand: 'LG',
        model: 'FHM1207',
        serialNumber: 'LG123456789',
        purchaseYear: 2023,
      },
    });
  }

  // Phone-only customer created by staff: Priya (demo scenario B). No email, no password.
  const priyaExists = await prisma.user.findFirst({ where: { phone: '9000000011', role: Role.CUSTOMER } });
  if (!priyaExists) {
    const priya = await prisma.user.create({
      data: { name: 'Priya Nair', phone: '9000000011', role: Role.CUSTOMER, createdByUserId: manager.id },
    });
    await prisma.address.create({
      data: { customerId: priya.id, label: 'Home', line1: 'Villa 12, Green Meadows', area: 'Gachibowli', pincode: '500032' },
    });
    await prisma.appliance.create({
      data: { customerId: priya.id, categoryId: categoryId.get('Air Conditioner')!, brand: 'Daikin', model: 'FTKM35', purchaseYear: 2022 },
    });
  }

  console.log('Seed complete.');
  console.log(`Demo logins (password for all: ${DEMO_PASSWORD})`);
  console.log(`  owner      ${owner.email}`);
  console.log(`  manager    ${manager.email}`);
  console.log('  technician rahul@homefix.test / arjun@homefix.test / suresh@homefix.test');
  console.log('  customer   ravi@example.test');
  console.log(`  (Ravi's address id: ${raviAddress.id}; Priya is phone-only, no login)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
