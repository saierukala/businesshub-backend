import type { Request, Response } from 'express';
import * as addresses from '../services/address.service';
import type * as s from '../routes/addresses.schemas';

const v = (req: Request) => req.validated!;
const id = (req: Request) => (v(req).params as { id: string }).id;

export async function list(req: Request, res: Response) {
  res.json(await addresses.listAddresses(req.user!, v(req).query as s.ListAddressesQuery));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await addresses.createAddress(req.user!, v(req).body as s.CreateAddressBody));
}

export async function update(req: Request, res: Response) {
  res.json(await addresses.updateAddress(req.user!, id(req), v(req).body as s.UpdateAddressBody));
}

export async function remove(req: Request, res: Response) {
  await addresses.deleteAddress(req.user!, id(req));
  res.status(204).end();
}
