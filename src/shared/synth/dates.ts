// UTC-only date math for the generator. No Intl, no toLocale*, no local-time Date methods, so a
// dataset generated on a Mac in Pacific time is byte-identical to one generated on CI in UTC.
// Dates are YYYY-MM-DD strings; they compare correctly as strings.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(date: string): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`not a YYYY-MM-DD date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = parts(date);
  return fromUtcMs(Date.UTC(y, m - 1, d)) === date;
}

export function toUtcMs(date: string): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
}

/** Unix seconds at 00:00:00 UTC of the date. */
export function toUnixSeconds(date: string): number {
  return Math.floor(toUtcMs(date) / 1000);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  return fromUtcMs(Date.UTC(y, m - 1, d + days));
}

export function firstOfMonth(date: string): string {
  const [y, m] = parts(date);
  return fromUtcMs(Date.UTC(y, m - 1, 1));
}

/** Adds whole months to a first-of-month date (the generator only shifts first-of-month dates). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  if (d !== 1) throw new Error(`addMonths expects a first-of-month date, got ${date}`);
  return fromUtcMs(Date.UTC(y, m - 1 + months, 1));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000);
}

/** ISO 8601 UTC timestamp for a date plus an hour and minute. */
export function atUtc(date: string, hour: number, minute = 0): string {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d, hour, minute)).toISOString();
}

export function minDate(a: string, b: string): string {
  return a < b ? a : b;
}
