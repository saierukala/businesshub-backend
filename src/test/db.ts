import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import { prisma } from '../db/prisma';
import { testQueue } from '../jobs/queue';

// Empties every table (except Prisma's migration history) so each test starts clean.
export async function resetDb() {
  testQueue.clear(); // jobs queued by an earlier test must not leak into this one
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  if (tables) await prisma.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

export const TEST_PASSWORD = 'password123';
const hash = bcrypt.hashSync(TEST_PASSWORD, 4); // low cost: tests stay fast

export function createUser(role: Role, overrides: { email?: string | null; password?: boolean; active?: boolean } = {}) {
  const email = overrides.email === undefined ? `${role.toLowerCase()}-${Math.random().toString(36).slice(2)}@t.test` : overrides.email;
  return prisma.user.create({
    data: {
      name: `Test ${role}`,
      email,
      role,
      passwordHash: overrides.password === false ? null : hash,
      active: overrides.active ?? true,
    },
  });
}
