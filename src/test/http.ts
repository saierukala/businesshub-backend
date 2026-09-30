import request from 'supertest';
import type { Role } from '@prisma/client';
import { createApp } from '../app';
import { TEST_PASSWORD, createUser } from './db';

export const app = createApp();

// Logs in and returns an agent that keeps the session cookie, like a browser.
export async function loginAs(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return agent;
}

// Creates a user with the role and returns { user, agent } already logged in.
export async function actor(role: Role) {
  const user = await createUser(role);
  return { user, agent: await loginAs(user.email!) };
}
