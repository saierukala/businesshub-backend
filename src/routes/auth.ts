import { Router } from 'express';
import * as c from '../controllers/auth.controller';
import * as s from './auth.schemas';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';

export const authRouter = Router();

authRouter.post('/register', validate({ body: s.registerBody }), c.register);
authRouter.post('/login', validate({ body: s.loginBody }), c.login);
authRouter.post('/logout', c.logout);
authRouter.get('/me', requireAuth, c.me);

authRouter.post('/forgot-password', validate({ body: s.emailBody }), c.forgotPassword);
authRouter.post('/reset-password', validate({ body: s.setPasswordBody }), c.resetPassword);
authRouter.post('/accept-invite', validate({ body: s.setPasswordBody }), c.acceptInvite);

authRouter.post('/verify-email', validate({ body: s.tokenBody }), c.verifyEmail);
authRouter.post('/resend-verification', requireAuth, c.resendVerification);

authRouter.post('/invite', requireAuth, requireRole('OWNER', 'MANAGER'), validate({ body: s.inviteBody }), c.invite);
