import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { computeSlots, type AvailabilityInput, type TechnicianInput } from './availability.compute';

// Mon 5 Oct 2026 is a Monday. "ist('2026-10-05 10:00')" is that wall-clock time in Asia/Kolkata.
const ist = (s: string) => DateTime.fromFormat(s, 'yyyy-MM-dd HH:mm', { zone: 'Asia/Kolkata' }).toJSDate();
const range = (from: string, to: string) => ({ startAt: ist(from), endAt: ist(to) });

const MONDAY = '2026-10-05';
const week = (over: Record<number, Partial<TechnicianInput['workingHours'][number]>> = {}) =>
  Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    startTime: '09:00',
    endTime: '18:00',
    isOff: dayOfWeek === 0,
    ...over[dayOfWeek],
  }));

const tech = (over: Partial<TechnicianInput> = {}): TechnicianInput => ({
  id: 't1',
  name: 'Rahul',
  active: true,
  categoryIds: ['fridge'],
  areas: ['Kondapur'],
  workingHours: week(),
  bookings: [],
  timeOff: [],
  ...over,
});

const run = (over: Partial<AvailabilityInput> = {}) =>
  computeSlots({
    date: MONDAY,
    categoryId: 'fridge',
    area: 'Kondapur',
    durationMinutes: 60,
    slotIntervalMinutes: 30,
    cutoffMinutes: 120,
    maxDaysAhead: 30,
    mode: 'customer',
    now: ist('2026-10-01 09:00'), // days before, so the cutoff never interferes unless a test says so
    technicians: [tech()],
    ...over,
  });

// "HH:mm" start times in IST, easier to read in assertions.
const starts = (slots: ReturnType<typeof run>) =>
  slots.map((s) => DateTime.fromJSDate(s.startAt, { zone: 'Asia/Kolkata' }).toFormat('HH:mm'));

describe('working hours', () => {
  it('offers 30-minute steps while the service still fits before closing', () => {
    const s = starts(run());
    expect(s[0]).toBe('09:00');
    expect(s.at(-1)).toBe('17:00'); // 17:00 + 60 min = 18:00 closing
    expect(s).toHaveLength(17);
  });

  it('a longer service loses the late slots', () => {
    const s = starts(run({ durationMinutes: 90 }));
    expect(s.at(-1)).toBe('16:30');
  });

  it('returns nothing on a day off, and on a weekday with no hours row', () => {
    expect(run({ date: '2026-10-04' })).toEqual([]); // Sunday is off
    expect(run({ technicians: [tech({ workingHours: week().filter((h) => h.dayOfWeek !== 1) })] })).toEqual([]);
  });

  it('honours a per-technician override for one weekday', () => {
    const s = starts(run({ technicians: [tech({ workingHours: week({ 1: { startTime: '10:00', endTime: '13:00' } }) })] }));
    expect(s).toEqual(['10:00', '10:30', '11:00', '11:30', '12:00']);
  });

  it('keeps slots on the clock grid even when hours start off-grid', () => {
    const s = starts(run({ technicians: [tech({ workingHours: week({ 1: { startTime: '09:15', endTime: '11:00' } }) })] }));
    expect(s).toEqual(['09:30', '10:00']);
  });
});

describe('existing bookings', () => {
  it('skips slots that overlap a booking; back-to-back is allowed', () => {
    const s = starts(run({ technicians: [tech({ bookings: [range('2026-10-05 09:00', '2026-10-05 10:00')] })] }));
    expect(s[0]).toBe('10:00'); // starts exactly when the booking ends
  });

  it('follows the spec example: busy 09-10, 11:30-12:30, 15-16, 60 min service', () => {
    const bookings = [
      range('2026-10-05 09:00', '2026-10-05 10:00'),
      range('2026-10-05 11:30', '2026-10-05 12:30'),
      range('2026-10-05 15:00', '2026-10-05 16:00'),
    ];
    const s = starts(run({ technicians: [tech({ bookings })] }));
    // The spec text lists "10:00, then 12:30". By its own rules 10:30 also fits (10:30-11:30 ends
    // exactly when the next booking starts), so it is offered.
    expect(s.slice(0, 4)).toEqual(['10:00', '10:30', '12:30', '13:00']);
    expect(s).not.toContain('11:00'); // 11:00-12:00 overlaps the 11:30 booking
    expect(s).not.toContain('14:30'); // 14:30-15:30 overlaps the 15:00 booking
    expect(s).toContain('16:00');
  });

  it('a booking that starts before the day and runs into it still blocks', () => {
    const s = starts(run({ technicians: [tech({ bookings: [range('2026-10-04 20:00', '2026-10-05 09:30')] })] }));
    expect(s[0]).toBe('09:30');
  });
});

describe('time off', () => {
  it('a whole day off leaves nothing', () => {
    const timeOff = [range('2026-10-05 00:00', '2026-10-06 00:00')];
    expect(run({ technicians: [tech({ timeOff })] })).toEqual([]);
  });

  it('a partial time off blocks only overlapping slots', () => {
    const timeOff = [range('2026-10-05 13:00', '2026-10-05 15:00')];
    const s = starts(run({ technicians: [tech({ timeOff })] }));
    expect(s).not.toContain('12:30'); // 12:30-13:30 overlaps
    expect(s).toContain('12:00'); // 12:00-13:00 touches only
    expect(s).toContain('15:00');
  });

  it('multi-day time off covers a middle day', () => {
    const timeOff = [range('2026-10-04 00:00', '2026-10-08 00:00')];
    expect(run({ technicians: [tech({ timeOff })] })).toEqual([]);
  });
});

describe('who qualifies', () => {
  it('needs an active technician with the skill and the area', () => {
    expect(run({ technicians: [tech({ active: false })] })).toEqual([]);
    expect(run({ technicians: [tech({ categoryIds: ['tv'] })] })).toEqual([]);
    expect(run({ technicians: [tech({ areas: ['Madhapur'] })] })).toEqual([]);
  });

  it('merges technicians into one slot list with who is free for each', () => {
    const a = tech({ id: 'a', name: 'A', bookings: [range('2026-10-05 09:00', '2026-10-05 10:00')] });
    const b = tech({ id: 'b', name: 'B' });
    const slots = run({ technicians: [a, b] });
    expect(slots[0].technicianIds).toEqual(['b']); // 09:00: only B is free
    expect(slots[2].technicianIds).toEqual(['a', 'b']); // 10:00: both
    expect(new Set(starts(slots)).size).toBe(slots.length); // one entry per start time
  });
});

describe('cutoff and booking window', () => {
  // now = Mon 5 Oct 2026 10:10 IST
  const now = ist('2026-10-05 10:10');

  it('customer: not before now + 2 hours', () => {
    expect(starts(run({ now }))[0]).toBe('12:30'); // 12:10 is the limit; next grid start is 12:30
  });

  it('customer: a slot exactly at the cutoff is allowed', () => {
    expect(starts(run({ now: ist('2026-10-05 10:00') }))[0]).toBe('12:00');
  });

  it('staff: cutoff relaxed, but never the past', () => {
    expect(starts(run({ now, mode: 'staff' }))[0]).toBe('10:30'); // 10:00 has already started
  });

  it('past days are empty in both modes', () => {
    expect(run({ date: '2026-10-04', now })).toEqual([]);
    expect(run({ date: '2026-10-04', now, mode: 'staff' })).toEqual([]);
  });

  it('limits how far ahead: day 30 yes, day 31 no', () => {
    const today = ist('2026-10-05 08:00');
    // 4 Nov 2026 is Wednesday, +30 days from 5 Oct.
    expect(run({ now: today, date: '2026-11-04' }).length).toBeGreaterThan(0);
    expect(run({ now: today, date: '2026-11-05' })).toEqual([]);
  });

  it('applies the same window to staff', () => {
    expect(run({ now: ist('2026-10-05 08:00'), date: '2026-11-05', mode: 'staff' })).toEqual([]);
  });
});

describe('timezone', () => {
  it('reads working hours as IST: 09:00 IST is 03:30 UTC', () => {
    expect(run()[0].startAt.toISOString()).toBe('2026-10-05T03:30:00.000Z');
  });

  it('uses the IST calendar day, not the UTC one', () => {
    // 23:30 UTC on 4 Oct is already 05:00 IST on 5 Oct: "today" is 5 Oct for the business.
    const now = new Date('2026-10-04T23:30:00Z');
    expect(starts(run({ now, mode: 'staff' }))[0]).toBe('09:00');
  });

  it('rejects an invalid date', () => {
    expect(run({ date: '2026-13-45' })).toEqual([]);
  });
});
