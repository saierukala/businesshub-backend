// PostgreSQL raises SQLSTATE 23P01 when an EXCLUDE constraint is violated,
// e.g. two active bookings for the same technician overlapping in time.
// Prisma surfaces it as an error whose message/meta contains the code or text,
// so we check both. Phase 6 uses this to return 409 SLOT_UNAVAILABLE.
export function isExclusionViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = err instanceof Error ? err.message : '';
  const metaCode = (err as { meta?: { code?: string } }).meta?.code;
  return (
    metaCode === '23P01' ||
    message.includes('23P01') ||
    message.toLowerCase().includes('exclusion constraint')
  );
}
