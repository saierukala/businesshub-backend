import { z } from 'zod';
import { pagination, queryBool } from '../validation/common';

export const listNotificationsQuery = pagination.extend({ unread: queryBool.optional() });
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;
