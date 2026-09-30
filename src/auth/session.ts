import jwt from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';
import type { Role } from '@prisma/client';
import { env } from '../config/env';

// The session is a JWT in an httpOnly cookie: JavaScript in the browser cannot read it
// (protects against XSS token theft), and the browser sends it automatically.
export const SESSION_COOKIE = 'bh_session';
const SESSION_DAYS = 7;

export type SessionPayload = { sub: string; role: Role; iat: number };

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production', // HTTPS only in production
  sameSite: 'lax', // same-site via the Next.js /api rewrite; blocks most CSRF
  path: '/',
};

export function setSessionCookie(res: Response, user: { id: string; role: Role }) {
  const token = jwt.sign({ role: user.role }, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: `${SESSION_DAYS}d`,
    algorithm: 'HS256',
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_DAYS * 86_400_000 });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}

// Returns null for missing, expired, tampered or wrongly signed tokens.
export function readSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || !payload.sub || !payload.iat) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}
