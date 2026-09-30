import crypto from 'node:crypto';
import type { AuthTokenType } from '@prisma/client';
import { prisma } from '../db/prisma';
import { AppError } from '../errors/AppError';

// One-time tokens (password reset, email verify, account invite).
// The raw token goes in the email link; only its SHA-256 hash is stored,
// so a leaked database does not leak usable links.
const hash = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');

export const TOKEN_TTL_MINUTES: Record<AuthTokenType, number> = {
  PASSWORD_RESET: 60,
  EMAIL_VERIFY: 24 * 60,
  ACCOUNT_INVITE: 7 * 24 * 60,
};

export async function createToken(userId: string, type: AuthTokenType): Promise<string> {
  const raw = crypto.randomBytes(32).toString('base64url');
  // Only the newest link of each type works: expire older unused ones.
  await prisma.authToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.authToken.create({
    data: {
      userId,
      type,
      tokenHash: hash(raw),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES[type] * 60_000),
    },
  });
  return raw;
}

// Marks the token used and returns its userId. The single conditional UPDATE is atomic,
// so two requests racing with the same link cannot both succeed.
export async function consumeToken(raw: string, type: AuthTokenType): Promise<string> {
  const tokenHash = hash(raw);
  const { count } = await prisma.authToken.updateMany({
    where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (count !== 1) throw AppError.badRequest('This link is invalid or has expired');
  const token = await prisma.authToken.findUniqueOrThrow({ where: { tokenHash } });
  return token.userId;
}
