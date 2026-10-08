// Effective-date rules shared by the Worker, the SPA, the generator and the evals.
// Effective ranges are half-open: [effectiveFrom, effectiveTo), effectiveTo null meaning open-ended.
// Dates are YYYY-MM-DD strings, which compare correctly as strings.
import type { VersionStatus } from "./domain.ts";

export type EffectiveRange = { effectiveFrom: string; effectiveTo: string | null };

export function isEffective(range: EffectiveRange, asOf: string): boolean {
  return range.effectiveFrom <= asOf && (range.effectiveTo === null || range.effectiveTo > asOf);
}

export function versionStatusAt(range: EffectiveRange, asOf: string): VersionStatus {
  if (range.effectiveFrom > asOf) return "scheduled";
  if (range.effectiveTo !== null && range.effectiveTo <= asOf) return "superseded";
  return "current";
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** The YYYY-MM-DD part of an ISO timestamp. */
export function dateOf(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/** Date-only addition in UTC. */
export function addDaysIso(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
