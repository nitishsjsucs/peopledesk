// Business date versus wall time. The business date (asOf) drives effective-date resolution,
// onboarding status and "upcoming sessions". Action expiry and timestamps always use wall time.
export interface Clock {
  /** Business date, YYYY-MM-DD (UTC). */
  asOf(): string;
  /** Wall-clock time as an ISO 8601 UTC timestamp. */
  nowIso(): string;
  nowMs(): number;
}

export class SystemClock implements Clock {
  asOf(): string {
    return new Date().toISOString().slice(0, 10);
  }
  nowIso(): string {
    return new Date().toISOString();
  }
  nowMs(): number {
    return Date.now();
  }
}

/** Dev only (AS_OF_OVERRIDE): fixes the business date, never the wall clock. */
export class FixedClock implements Clock {
  private readonly date: string;
  constructor(asOf: string) {
    this.date = asOf;
  }
  asOf(): string {
    return this.date;
  }
  nowIso(): string {
    return new Date().toISOString();
  }
  nowMs(): number {
    return Date.now();
  }
}

export function clockFor(asOfOverride: string | null): Clock {
  return asOfOverride ? new FixedClock(asOfOverride) : new SystemClock();
}
