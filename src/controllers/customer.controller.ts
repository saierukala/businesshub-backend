import type { Request, Response } from 'express';
import * as customers from '../services/customer.service';
import type * as s from '../routes/customers.schemas';

const v = (req: Request) => req.validated!;
const id = (req: Request) => (v(req).params as { id: string }).id;

export async function search(req: Request, res: Response) {
  res.json(await customers.searchCustomers(v(req).query as s.ListCustomersQuery));
}

export async function get(req: Request, res: Response) {
  res.json(await customers.getCustomer(id(req)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await customers.createCustomer(req.user!.id, v(req).body as s.CreateCustomerBody));
}

export async function update(req: Request, res: Response) {
  res.json(await customers.updateCustomer(req.user!.id, id(req), v(req).body as s.UpdateCustomerBody));
}
