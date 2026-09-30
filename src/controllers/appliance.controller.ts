import type { Request, Response } from 'express';
import * as appliances from '../services/appliance.service';
import { applianceHistory } from '../services/appliance.history';
import type * as s from '../routes/appliances.schemas';

const v = (req: Request) => req.validated!;
const id = (req: Request) => (v(req).params as { id: string }).id;

export async function list(req: Request, res: Response) {
  res.json(await appliances.listAppliances(req.user!, v(req).query as s.ListAppliancesQuery));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await appliances.createAppliance(req.user!, v(req).body as s.CreateApplianceBody));
}

export async function history(req: Request, res: Response) {
  res.json(await applianceHistory(req.user!, id(req), v(req).query as { page: number; pageSize: number }));
}

export async function update(req: Request, res: Response) {
  res.json(await appliances.updateAppliance(req.user!, id(req), v(req).body as s.UpdateApplianceBody));
}

export async function remove(req: Request, res: Response) {
  await appliances.deleteAppliance(req.user!, id(req));
  res.status(204).end();
}
