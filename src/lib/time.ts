// Salons work in local wall-clock time; the database stores instants (UTC).
// Indonesian time zones have no daylight saving, but the offset is still
// derived from Intl so another zone would work too.

/** Offset of `tz` from UTC at `instant`, in minutes (Asia/Jakarta = 420). */
export function offsetMinutes(tz: string, instant: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(instant).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** The instant of `minutes` after local midnight on `date` (YYYY-MM-DD) in `tz`. */
export function localToUtc(date: string, minutes: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, minutes));
  return new Date(guess.getTime() - offsetMinutes(tz, guess) * 60000);
}

/** Local calendar date (YYYY-MM-DD) of an instant. */
export function localDate(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(instant);
}

/** Day of week of a local date, 0 = Sunday. */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function formatTime(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("id-ID", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(instant).replace(".", ":");
}

export function formatDate(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("id-ID", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .format(instant);
}
