// Whole-day arithmetic on YYYY-MM-DD dates (or the date part of an ISO timestamp), in UTC, so a day
// count shown in the UI agrees with the dates stored in D1 whatever the browser's time zone.

const DAY_MS = 86_400_000;

/** The YYYY-MM-DD part of a date or an ISO timestamp. */
export const dayOf = (value: string): string => value.slice(0, 10);

/** Whole days from a to b (negative when b is before a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${dayOf(b)}T00:00:00Z`) - Date.parse(`${dayOf(a)}T00:00:00Z`)) / DAY_MS);
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "today", "in 3 days" or "3 days ago": where a date stands from asOf. Never a negative number. */
export function relativeDays(date: string, asOf: string): string {
  const d = daysBetween(asOf, date);
  if (d === 0) return "today";
  return d > 0 ? `in ${plural(d, "day")}` : `${plural(-d, "day")} ago`;
}
