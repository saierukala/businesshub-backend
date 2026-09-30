import type { Request, Response } from 'express';
import * as tech from '../services/technician.service';
import type * as s from '../routes/technicians.schemas';

const v = (req: Request) => req.validated!;
const p = (req: Request) => v(req).params as { id: string; timeOffId: string };
const body = <T>(req: Request) => v(req).body as T;

export async function list(req: Request, res: Response) {
  res.json(await tech.listTechnicians(v(req).query as s.ListTechniciansQuery));
}

export async function get(req: Request, res: Response) {
  res.json(await tech.getTechnician(p(req).id));
}

export async function setSkills(req: Request, res: Response) {
  res.json(await tech.setSkills(req.user!.id, p(req).id, body<{ categoryIds: string[] }>(req).categoryIds));
}

export async function setAreas(req: Request, res: Response) {
  res.json(await tech.setAreas(req.user!.id, p(req).id, body<{ areas: string[] }>(req).areas));
}

export async function setWorkingHours(req: Request, res: Response) {
  res.json(await tech.setWorkingHours(req.user!.id, p(req).id, body<s.SetWorkingHoursBody>(req)));
}

export async function listTimeOff(req: Request, res: Response) {
  res.json(await tech.listTimeOff(p(req).id, v(req).query as s.ListTimeOffQuery));
}

export async function createTimeOff(req: Request, res: Response) {
  res.status(201).json(await tech.createTimeOff(req.user!.id, p(req).id, body<s.CreateTimeOffBody>(req)));
}

export async function deleteTimeOff(req: Request, res: Response) {
  const { id, timeOffId } = p(req);
  await tech.deleteTimeOff(req.user!.id, id, timeOffId);
  res.status(204).end();
}
