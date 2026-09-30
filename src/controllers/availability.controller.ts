import type { Request, Response } from 'express';
import * as availability from '../services/availability.service';
import type { AvailabilityQuery } from '../routes/availability.schemas';

export async function get(req: Request, res: Response) {
  res.json(await availability.getAvailability(req.user!.role, req.validated!.query as AvailabilityQuery));
}
