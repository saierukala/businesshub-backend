import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { prisma } from '../db/prisma';
import { AppError } from '../errors/AppError';
import { consumeToken, createToken } from './token.service';
import { link, mailer } from './email.service';

const BCRYPT_ROUNDS = 12;
// Compared against when the email is unknown, so "no such user" takes as long as
// "wrong password" and response timing does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

// Never send passwordHash to the client.
export function publicUser(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    emailVerified: u.emailVerifiedAt !== null,
  };
}

export async function register(input: { name: string; email: string; phone?: string; password: string }) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  // A staff-created customer with this email must claim the account via forgot password
  // (proves they own the inbox). Registering over it would let anyone hijack their history.
  if (existing) {
    throw AppError.conflict(
      'An account with this email already exists. Log in, or use "Forgot password" to set a password.',
      'EMAIL_TAKEN',
    );
  }
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      role: 'CUSTOMER', // public sign-up can only ever create customers
      passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
    },
  });
  await sendVerificationEmail(user);
  return user;
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !ok) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  // Only revealed after a correct password, so it does not leak account status.
  if (!user.active) throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated');
  return user;
}

export async function getMe(userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId } });
}

// Always succeeds from the caller's view (no "email not found"), to prevent account probing.
// Also how a staff-created customer claims their account once an email is on file.
export async function forgotPassword(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) return;
  const token = await createToken(user.id, 'PASSWORD_RESET');
  await mailer.send({
    to: email,
    subject: 'Reset your HomeFix password',
    text: `Set a new password (link valid for 1 hour): ${link('/reset-password', token)}`,
  });
}

// Used by both reset-password and accept-invite. Setting a password through an emailed
// link also proves the user owns the email, so we mark it verified.
export async function setPasswordWithToken(rawToken: string, password: string, type: 'PASSWORD_RESET' | 'ACCOUNT_INVITE') {
  const userId = await consumeToken(rawToken, type);
  const now = new Date();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.active) throw AppError.badRequest('This link is invalid or has expired');
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      passwordChangedAt: now, // logs out every existing session
      emailVerifiedAt: user.emailVerifiedAt ?? now,
    },
  });
  // Any other outstanding reset/invite links for this user stop working.
  await prisma.authToken.updateMany({
    where: { userId, usedAt: null, type: { in: ['PASSWORD_RESET', 'ACCOUNT_INVITE'] } },
    data: { usedAt: now },
  });
}

export async function sendVerificationEmail(user: User) {
  if (!user.email || user.emailVerifiedAt) return;
  const token = await createToken(user.id, 'EMAIL_VERIFY');
  await mailer.send({
    to: user.email,
    subject: 'Verify your HomeFix email',
    text: `Confirm your email address: ${link('/verify-email', token)}`,
  });
}

export async function resendVerification(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.email) throw AppError.badRequest('No email address on this account');
  if (user.emailVerifiedAt) throw AppError.conflict('Email is already verified', 'ALREADY_VERIFIED');
  await sendVerificationEmail(user);
}

export async function verifyEmail(rawToken: string) {
  const userId = await consumeToken(rawToken, 'EMAIL_VERIFY');
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
}

// Staff invite a customer they created (phone/walk-in) to claim the online account.
// Only for customers that have an email but no password yet.
export async function inviteCustomer(customerId: string) {
  const user = await prisma.user.findUnique({ where: { id: customerId } });
  if (!user || user.role !== 'CUSTOMER') throw AppError.notFound('Customer not found');
  if (!user.active) throw AppError.conflict('Customer account is deactivated', 'ACCOUNT_DISABLED');
  if (!user.email) throw AppError.badRequest('Add an email address to this customer first');
  if (user.passwordHash) throw AppError.conflict('Customer already has an online account', 'ALREADY_REGISTERED');

  const token = await createToken(user.id, 'ACCOUNT_INVITE');
  await mailer.send({
    to: user.email,
    subject: 'Your HomeFix account is ready',
    text:
      `Hi ${user.name}, HomeFix has created an account for your bookings. ` +
      `Set a password to view your bookings online (link valid for 7 days): ${link('/accept-invite', token)}`,
  });
}
