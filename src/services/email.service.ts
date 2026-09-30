import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../config/logger';

// With SMTP_URL we send real email. Without it, jsonTransport "sends" nowhere and we log
// the message, so in development you can copy the reset/verify link from the terminal.
const transport = env.SMTP_URL
  ? nodemailer.createTransport(env.SMTP_URL)
  : nodemailer.createTransport({ jsonTransport: true });

export type Email = { to: string; subject: string; text: string };

// Wrapped in an object so tests can spy on mailer.send and read the links.
export const mailer = {
  async send(email: Email): Promise<void> {
    await transport.sendMail({ from: env.EMAIL_FROM, ...email });
    if (!env.SMTP_URL) logger.info({ email }, 'Email (not sent, no SMTP_URL)');
  },
};

export function link(path: string, token: string) {
  return `${env.FRONTEND_URL}${path}?token=${encodeURIComponent(token)}`;
}
