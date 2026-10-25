import { describe, expect, it } from "vitest";
import { availableSlots } from "@/lib/availability";
import { addDays, localDate, localToUtc, weekday } from "@/lib/time";

const TZ = "Asia/Jakarta";
const DATE = "2026-11-02"; // a Monday
const at = (hhmm: string) => localToUtc(DATE, +hhmm.slice(0, 2) * 60 + +hhmm.slice(3), TZ);
const NIGHT_BEFORE = new Date("2026-11-01T12:00:00Z");

describe("time", () => {
  it("converts Jakarta wall-clock time to UTC", () => {
    expect(localToUtc(DATE, 9 * 60, TZ).toISOString()).toBe("2026-11-02T02:00:00.000Z");
    expect(localToUtc(DATE, 23 * 60 + 30, TZ).toISOString()).toBe("2026-11-02T16:30:00.000Z");
  });
  it("finds the local date near midnight", () => {
    expect(localDate(new Date("2026-11-01T17:30:00Z"), TZ)).toBe("2026-11-02"); // 00:30 WIB
    expect(weekday(DATE)).toBe(1);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("works for WITA too", () => {
    expect(localToUtc(DATE, 9 * 60, "Asia/Makassar").toISOString()).toBe("2026-11-02T01:00:00.000Z");
  });
});

describe("availableSlots", () => {
  const shift = [{ startMin: 9 * 60, endMin: 12 * 60 }];

  it("offers every 15 minutes while the whole service fits in the shift", () => {
    const slots = availableSlots({ date: DATE, tz: TZ, durationMin: 60, now: NIGHT_BEFORE,
                                   staff: [{ id: "a", hours: shift, busy: [] }] });
    expect(slots[0].start).toEqual(at("09:00"));
    expect(slots.at(-1)!.start).toEqual(at("11:00")); // 11:00-12:00 is the last fit
    expect(slots).toHaveLength(9);
  });

  it("skips anything overlapping a booking, but allows back-to-back", () => {
    const busy = [{ start: at("10:00"), end: at("10:45") }];
    const starts = availableSlots({ date: DATE, tz: TZ, durationMin: 30, now: NIGHT_BEFORE,
                                    staff: [{ id: "a", hours: shift, busy }] }).map((s) => s.start.getTime());
    expect(starts).toContain(at("09:30").getTime());     // ends 10:00 exactly
    expect(starts).not.toContain(at("09:45").getTime()); // would end 10:15
    expect(starts).not.toContain(at("10:30").getTime());
    expect(starts).toContain(at("10:45").getTime());     // starts as the booking ends
  });

  it("merges staff and lists who is free", () => {
    const slots = availableSlots({ date: DATE, tz: TZ, durationMin: 60, now: NIGHT_BEFORE, staff: [
      { id: "a", hours: shift, busy: [{ start: at("09:00"), end: at("10:00") }] },
      { id: "b", hours: [{ startMin: 10 * 60, endMin: 13 * 60 }], busy: [] },
    ] });
    const byTime = Object.fromEntries(slots.map((s) => [s.start.toISOString(), s.staffIds]));
    expect(byTime[at("09:00").toISOString()]).toBeUndefined();
    expect(byTime[at("10:00").toISOString()]).toEqual(["a", "b"]);
    expect(byTime[at("12:00").toISOString()]).toEqual(["b"]);
  });

  it("respects the lead time", () => {
    const now = at("09:20");
    const slots = availableSlots({ date: DATE, tz: TZ, durationMin: 30, now, leadMin: 60,
                                   staff: [{ id: "a", hours: shift, busy: [] }] });
    expect(slots[0].start).toEqual(at("10:30"));
  });

  it("supports split shifts", () => {
    const slots = availableSlots({ date: DATE, tz: TZ, durationMin: 60, now: NIGHT_BEFORE, staff: [{ id: "a", busy: [],
      hours: [{ startMin: 9 * 60, endMin: 11 * 60 }, { startMin: 13 * 60, endMin: 15 * 60 }] }] });
    expect(slots.map((s) => s.start)).not.toContainEqual(at("10:30"));
    expect(slots.map((s) => s.start)).toContainEqual(at("13:00"));
  });
});
