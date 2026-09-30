import { z } from 'zod';
import { area, pagination, uuid } from '../validation/common';

export const listTechniciansQuery = pagination.extend({
  q: z.string().trim().max(100).optional(),
});

export const techParams = z.object({ id: uuid });
export const timeOffParams = z.object({ id: uuid, timeOffId: uuid });

// Replaces the whole list, so the screen can send exactly what it shows.
export const setSkillsBody = z.object({ categoryIds: z.array(uuid).max(20) });
export const setAreasBody = z.object({ areas: z.array(area).max(50) });

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, e.g. 09:00');

// All 7 days at once (0 = Sunday ... 6 = Saturday). A day off keeps its times but isOff = true.
export const setWorkingHoursBody = z.object({
  days: z
    .array(z.object({ dayOfWeek: z.number().int().min(0).max(6), startTime: time, endTime: time, isOff: z.boolean() }))
    .length(7)
    .superRefine((days, ctx) => {
      if (new Set(days.map((d) => d.dayOfWeek)).size !== 7) {
        ctx.addIssue({ code: 'custom', message: 'Send each day of the week exactly once' });
      }
      days.forEach((d, i) => {
        if (!d.isOff && d.startTime >= d.endTime) {
          ctx.addIssue({ code: 'custom', path: [i, 'endTime'], message: 'End time must be after start time' });
        }
      });
    }),
});

export const listTimeOffQuery = pagination.extend({
  // Default: only time off that has not ended yet.
  includePast: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// Times are ISO timestamps with an offset, e.g. 2026-10-05T09:00:00+05:30 (stored as UTC).
const instant = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v));

export const createTimeOffBody = z
  .object({
    startAt: instant,
    endAt: instant,
    reason: z.enum(['SICK', 'LEAVE', 'OTHER']).default('OTHER'),
    note: z.string().trim().max(300).optional(),
  })
  .refine((b) => b.endAt > b.startAt, { path: ['endAt'], message: 'End must be after start' });

export type ListTechniciansQuery = z.infer<typeof listTechniciansQuery>;
export type SetWorkingHoursBody = z.infer<typeof setWorkingHoursBody>;
export type ListTimeOffQuery = z.infer<typeof listTimeOffQuery>;
export type CreateTimeOffBody = z.infer<typeof createTimeOffBody>;
