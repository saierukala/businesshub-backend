import type { Request, Response } from 'express';
import * as auth from '../services/auth.service';
import { clearSessionCookie, setSessionCookie } from '../auth/session';
import type * as s from '../routes/auth.schemas';

// Thin controllers: read validated input, call the service, send the response.
const body = <T>(req: Request) => req.validated!.body as T;

export async function register(req: Request, res: Response) {
  const user = await auth.register(body<s.RegisterBody>(req));
  setSessionCookie(res, user);
  res.status(201).json({ user: auth.publicUser(user) });
}

export async function login(req: Request, res: Response) {
  const { email, password } = body<s.LoginBody>(req);
  const user = await auth.login(email, password);
  setSessionCookie(res, user);
  res.json({ user: auth.publicUser(user) });
}

export function logout(_req: Request, res: Response) {
  clearSessionCookie(res);
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  res.json({ user: auth.publicUser(await auth.getMe(req.user!.id)) });
}

export async function forgotPassword(req: Request, res: Response) {
  await auth.forgotPassword(body<s.EmailBody>(req).email);
  res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
}

export async function resetPassword(req: Request, res: Response) {
  const { token, password } = body<s.SetPasswordBody>(req);
  await auth.setPasswordWithToken(token, password, 'PASSWORD_RESET');
  clearSessionCookie(res);
  res.json({ message: 'Password updated. Please log in.' });
}

export async function acceptInvite(req: Request, res: Response) {
  const { token, password } = body<s.SetPasswordBody>(req);
  await auth.setPasswordWithToken(token, password, 'ACCOUNT_INVITE');
  clearSessionCookie(res);
  res.json({ message: 'Account ready. Please log in.' });
}

export async function verifyEmail(req: Request, res: Response) {
  await auth.verifyEmail(body<s.TokenBody>(req).token);
  res.json({ message: 'Email verified.' });
}

export async function resendVerification(req: Request, res: Response) {
  await auth.resendVerification(req.user!.id);
  res.json({ message: 'Verification email sent.' });
}

export async function invite(req: Request, res: Response) {
  await auth.inviteCustomer(body<s.InviteBody>(req).customerId);
  res.json({ message: 'Invite sent.' });
}
