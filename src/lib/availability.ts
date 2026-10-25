import { localToUtc } from "./time";

export type Interval = { start: Date; end: Date };
export type StaffDay = {
  id: string;
  hours: { startMin: number; endMin: number }[]; // that weekday's shifts, local minutes
  busy: Interval[];                               // active bookings (confirmed or still on hold)
};
export type Slot = { start: Date; end: Date; staffIds: string[] };

/**
 * Bookable start times for one service on one local date. A slot is offered
 * when at least one staff member who does the service is on shift for the
 * whole duration and has no overlapping booking. Pure, so it is unit tested;
 * the database's exclusion constraint is what finally guarantees no overlap.
 */
export function availableSlots(opts: {
  date: string;
  tz: string;
  durationMin: number;
  staff: StaffDay[];
  now: Date;
  stepMin?: number;
  leadMin?: number; // no bookings starting sooner than this
}): Slot[] {
  const step = opts.stepMin ?? 15;
  const earliest = opts.now.getTime() + (opts.leadMin ?? 60) * 60000;
  const slots = new Map<number, Slot>();

  for (const s of opts.staff) {
    for (const shift of s.hours) {
      for (let m = shift.startMin; m + opts.durationMin <= shift.endMin; m += step) {
        const start = localToUtc(opts.date, m, opts.tz);
        const end = new Date(start.getTime() + opts.durationMin * 60000);
        if (start.getTime() < earliest) continue;
        if (s.busy.some((b) => b.start < end && start < b.end)) continue;
        const key = start.getTime();
        const slot = slots.get(key) ?? { start, end, staffIds: [] };
        slot.staffIds.push(s.id);
        slots.set(key, slot);
      }
    }
  }
  return [...slots.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}
