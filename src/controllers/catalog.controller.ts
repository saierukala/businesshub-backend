import type { Request, Response } from 'express';
import * as catalog from '../services/catalog.service';
import type * as s from '../routes/catalog.schemas';
import type { PageInput } from '../db/paginate';

const v = (req: Request) => req.validated!;
const id = (req: Request) => (v(req).params as { id: string }).id;

export async function listCategories(req: Request, res: Response) {
  res.json(await catalog.listCategories(v(req).query as PageInput));
}

export async function createCategory(req: Request, res: Response) {
  res.status(201).json(await catalog.createCategory((v(req).body as { name: string }).name));
}

export async function renameCategory(req: Request, res: Response) {
  res.json(await catalog.renameCategory(id(req), (v(req).body as { name: string }).name));
}

export async function listServices(req: Request, res: Response) {
  res.json(await catalog.listServices(req.user!.role, v(req).query as s.ListServicesQuery));
}

export async function getService(req: Request, res: Response) {
  res.json(await catalog.getService(req.user!.role, id(req)));
}

export async function createService(req: Request, res: Response) {
  res.status(201).json(await catalog.createService(v(req).body as s.CreateServiceBody));
}

export async function updateService(req: Request, res: Response) {
  res.json(await catalog.updateService(id(req), v(req).body as s.UpdateServiceBody));
}
