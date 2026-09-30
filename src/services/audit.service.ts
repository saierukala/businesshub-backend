import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';

type Db = Prisma.TransactionClient | typeof prisma;

export type AuditEntry = {
  userId: string; // who did it
  action: string; // e.g. CUSTOMER_UPDATED
  entityType: string; // e.g. User
  entityId: string;
  metadata?: Prisma.InputJsonValue;
};

// Pass the transaction client (tx) when the change runs in a transaction,
// so the audit row is saved or rolled back together with the change.
export function writeAudit(entry: AuditEntry, db: Db = prisma) {
  return db.auditLog.create({ data: entry });
}
