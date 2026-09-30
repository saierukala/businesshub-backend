import { DateTime } from 'luxon';

// PURE availability engine: no database, no clock, no I/O. Everything it needs comes in as
// arguments (including `now`), so it can be unit tested with fixed inputs.
// All business time is Asia/Kolkata; instants (Date) are UTC underneath.

export const BUSINESS_TZ = 'Asia/Kolkata';

export type Interval = { startAt: Date; endAt: Date };

export type TechnicianInput = {
  id: string;
  name: string;
  active: boolean;
  categoryIds: string[]; // skills
  areas: string[]; // service areas, same spelling as Address.area
  workingHours: { dayOfWeek: number; startTime: string; endTime: string; isOff: boolean }[]; // 0 = Sunday
  bookings: Interval[]; // only bookings that still block the technician (not cancelled / no-show)
  timeOff: Interval[];
};

export type AvailabilityInput = {
  date: string; // "YYYY-MM-DD", a calendar day in Asia/Kolkata
  categoryId: string; // category of the requested service
  area: string;
  durationMinutes: number;
  slotIntervalMinutes: number;
  cutoffMinutes: number;
  maxDaysAhead: number;
  // customer: normal cutoff. staff: cutoff relaxed, but never the past.
  mode: 'customer' | 'staff';
  now: Date;
  technicians: TechnicianInput[];
};

export type Slot = { startAt: Date; endAt: Date; technicianIds: string[] };

const overlaps = (a: Interval, b: Interval) => a.startAt < b.endAt && b.startAt < a.endAt; // touching is fine

export function computeSlots(input: AvailabilityInput): Slot[] {
  const day = DateTime.fromISO(input.date, { zone: BUSINESS_TZ }).startOf('day');
  if (!day.isValid) return [];

  // Booking window: not before today, not more than maxDaysAhead days from today.
  const today = DateTime.fromJSDate(input.now, { zone: BUSINESS_TZ }).startOf('day');
  if (day < today || day > today.plus({ days: input.maxDaysAhead })) return [];

  // The earliest allowed start. Staff can book inside the cutoff, never in the past.
  const earliest = input.mode === 'customer' ? input.now.getTime() + input.cutoffMinutes * 60_000 : input.now.getTime();
  const dayOfWeek = day.weekday % 7; // luxon: Mon = 1 ... Sun = 7. Ours: Sun = 0.

  const slots = new Map<number, Slot>(); // keyed by start time

  for (const tech of input.technicians) {
    // Rules 1 and 2: active, has the skill, covers the area.
    if (!tech.active || !tech.categoryIds.includes(input.categoryId) || !tech.areas.includes(input.area)) continue;

    // Rule 3: working hours for this weekday. No row, or a day off, means not working.
    const hours = tech.workingHours.find((h) => h.dayOfWeek === dayOfWeek);
    if (!hours || hours.isOff) continue;
    const open = atTime(day, hours.startTime);
    const close = atTime(day, hours.endTime);

    // Slots start on the clock grid (09:00, 09:30, ...), so every technician offers the same start times.
    for (let minute = 0; minute < 24 * 60; minute += input.slotIntervalMinutes) {
      const start = day.plus({ minutes: minute });
      if (start < open) continue;
      const end = start.plus({ minutes: input.durationMinutes });
      if (end > close) break;

      const slot: Interval = { startAt: start.toJSDate(), endAt: end.toJSDate() };
      if (slot.startAt.getTime() < earliest) continue; // rule 5
      if (tech.bookings.some((b) => overlaps(slot, b))) continue; // rule 4
      if (tech.timeOff.some((t) => overlaps(slot, t))) continue; // rule 6

      const key = slot.startAt.getTime();
      const existing = slots.get(key);
      if (existing) existing.technicianIds.push(tech.id);
      else slots.set(key, { ...slot, technicianIds: [tech.id] });
    }
  }

  return [...slots.values()].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

// "09:30" on the given day, in the business timezone.
function atTime(day: DateTime, hhmm: string): DateTime {
  const [hour, minute] = hhmm.split(':').map(Number);
  return day.set({ hour, minute });
}
