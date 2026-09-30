import { z } from 'zod';
import { email, name, pagination, phone, queryBool } from '../validation/common';

export const listUsersQuery = pagination.extend({
  role: z.enum(['OWNER', 'MANAGER', 'TECHNICIAN', 'CUSTOMER']).optional(),
  active: queryBool.optional(),
  q: z.string().trim().max(100).optional(),
});

// The owner creates staff accounts. Email is required (it's how they log in); they get an
// invite link and choose their own password. Owners are not created through the API.
export const createUserBody = z.object({
  name,
  email,
  phone,
  role: z.enum(['MANAGER', 'TECHNICIAN']),
});

export const setActiveBody = z.object({ active: z.boolean() });

export type ListUsersQuery = z.infer<typeof listUsersQuery>;
export type CreateUserBody = z.infer<typeof createUserBody>;
