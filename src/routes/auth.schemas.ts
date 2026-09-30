import { z } from 'zod';

// Emails are trimmed and lower-cased so "Ravi@X.com" and "ravi@x.com" are one account.
const email = z.string().trim().toLowerCase().email().max(254);
// bcrypt only uses the first 72 bytes, so cap the length.
const password = z.string().min(8, 'Password must be at least 8 characters').max(72);
// Indian mobile number: 10 digits starting 6-9.
const phone = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number');
const token = z.string().min(20).max(200);

export const registerBody = z.object({
  name: z.string().trim().min(2).max(100),
  email,
  phone: phone.optional(),
  password,
});
export const loginBody = z.object({ email, password: z.string().min(1).max(72) });
export const emailBody = z.object({ email });
export const tokenBody = z.object({ token });
export const setPasswordBody = z.object({ token, password });
export const inviteBody = z.object({ customerId: z.string().uuid() });

export type RegisterBody = z.infer<typeof registerBody>;
export type LoginBody = z.infer<typeof loginBody>;
export type EmailBody = z.infer<typeof emailBody>;
export type TokenBody = z.infer<typeof tokenBody>;
export type SetPasswordBody = z.infer<typeof setPasswordBody>;
export type InviteBody = z.infer<typeof inviteBody>;
