import type { Request, Response } from 'express';
import * as users from '../services/user.service';
import type * as s from '../routes/users.schemas';

const v = (req: Request) => req.validated!;
const id = (req: Request) => (v(req).params as { id: string }).id;

export async function list(req: Request, res: Response) {
  res.json(await users.listUsers(v(req).query as s.ListUsersQuery));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await users.createUser(req.user!.id, v(req).body as s.CreateUserBody));
}

export async function setActive(req: Request, res: Response) {
  res.json(await users.setActive(req.user!.id, id(req), (v(req).body as { active: boolean }).active));
}

export async function resendInvite(req: Request, res: Response) {
  await users.resendInvite(id(req));
  res.json({ message: 'Invite sent.' });
}
