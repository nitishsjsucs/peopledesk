// The team onboarding overview (GET /api/team/onboarding) as the Onboarding page and Home show it:
// filters, sort orders and the text line under each person's task bar. Pure functions, so the page
// and its tests agree on one definition.
import type { OnboardingOverviewPerson } from "../../shared/api-types.ts";
import { daysBetween, plural } from "./dates.ts";

export const SHOW_FILTERS = ["unbooked", "blocked", "overdue"] as const;
export type ShowFilter = "all" | (typeof SHOW_FILTERS)[number];

export const SORTS = ["attention", "name", "start"] as const;
export type SortOrder = (typeof SORTS)[number];

export const SORT_LABEL: Record<SortOrder, string> = { attention: "Needs attention first", name: "Name", start: "Start date" };

export const matchesShow = (p: OnboardingOverviewPerson, show: ShowFilter): boolean =>
  show === "unbooked" ? p.orientation === null : show === "blocked" ? p.tasks.blocked > 0 : show === "overdue" ? p.tasks.overdue > 0 : true;

const byId = (a: OnboardingOverviewPerson, b: OnboardingOverviewPerson) => (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0);
const byStart = (a: OnboardingOverviewPerson, b: OnboardingOverviewPerson) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0);

/**
 * Needs attention first: most overdue tasks, then most blocked, then not booked before booked, then
 * the earliest start, then the employee id. Name and Start date sort as labeled.
 */
export function sortPeople(people: readonly OnboardingOverviewPerson[], sort: SortOrder): OnboardingOverviewPerson[] {
  const out = [...people];
  if (sort === "name") return out.sort((a, b) => a.fullName.localeCompare(b.fullName, "en") || byId(a, b));
  if (sort === "start") return out.sort((a, b) => byStart(a, b) || byId(a, b));
  return out.sort(
    (a, b) =>
      b.tasks.overdue - a.tasks.overdue ||
      b.tasks.blocked - a.tasks.blocked ||
      Number(a.orientation !== null) - Number(b.orientation !== null) ||
      byStart(a, b) ||
      byId(a, b),
  );
}

/**
 * Where asOf falls in a plan, short form for a list row: "starts in 15 days", "starts today",
 * "day 25 of 90", or "3 days past target". Day N counts whole days since the start date.
 */
export function planPhaseShort(startDate: string, targetDate: string, asOf: string): string {
  const day = daysBetween(startDate, asOf);
  const length = daysBetween(startDate, targetDate);
  if (day < 0) return `starts in ${plural(-day, "day")}`;
  if (day === 0) return "starts today";
  if (asOf > targetDate) return `${plural(daysBetween(targetDate, asOf), "day")} past target`;
  return `day ${day} of ${length}`;
}

/** The text line under a person's task bar, and its accessible name: "7 of 12 done · 2 overdue · day 25 of 90". */
export function personLine(p: OnboardingOverviewPerson, asOf: string): string {
  const parts = [`${p.tasks.done} of ${p.tasks.total} done`];
  if (p.tasks.overdue > 0) parts.push(`${p.tasks.overdue} overdue`);
  if (p.tasks.blocked > 0) parts.push(`${p.tasks.blocked} blocked`);
  parts.push(planPhaseShort(p.startDate, p.targetCompletionDate, asOf));
  return parts.join(" · ");
}

/** What a tile filter with no one in it says. */
export const EMPTY_FILTER_TEXT: Record<Exclude<ShowFilter, "all">, string> = {
  unbooked: "Everyone here is booked for orientation.",
  blocked: "No one has blocked tasks.",
  overdue: "No one is overdue.",
};
