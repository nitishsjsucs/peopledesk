// The team overview's filters and attention order (src/web/lib/onboarding-overview.ts), against the
// seed: "Not booked" counts the people who still need an orientation session, which leaves out the
// ones whose orientation task is done without a booking.
import { describe, expect, it } from "vitest";
import { matchesShow, needsOrientation, sortPeople } from "../../src/web/lib/onboarding-overview.ts";
import type { OnboardingOverviewPerson } from "../../src/shared/api-types.ts";
import { everyoneIds, overviewFor } from "./seed.ts";

const everyone = overviewFor(everyoneIds).people;
const person = (id: string) => everyone.find((p) => p.employeeId === id) as OnboardingOverviewPerson;

describe("needsOrientation and the Not booked filter", () => {
  it("needs a session only without a booking and with the orientation task not done", () => {
    expect(needsOrientation({ orientation: null, orientationTaskDone: false })).toBe(true);
    expect(needsOrientation({ orientation: null, orientationTaskDone: true })).toBe(false);
    expect(needsOrientation({ orientation: { sessionId: "ORI-001", startsAt: "2026-10-15T15:00:00.000Z" }, orientationTaskDone: false })).toBe(false);
    expect(needsOrientation({ orientation: { sessionId: "ORI-001", startsAt: "2026-10-15T15:00:00.000Z" }, orientationTaskDone: true })).toBe(false);
  });

  it("counts 8 of HR's 12 people without a booking: the seed's 4 with the orientation task done are left out", () => {
    expect(everyone.filter((p) => p.orientation === null)).toHaveLength(12);
    const unbooked = everyone.filter((p) => matchesShow(p, "unbooked")).map((p) => p.employeeId);
    expect(unbooked).toEqual(["E0024", "E0025", "E0033", "E0036", "E0076", "E0079", "E0104", "E0119"]);
    for (const id of ["E0064", "E0084", "E0085", "E0107"]) expect(matchesShow(person(id), "unbooked"), id).toBe(false);
  });

  it("ranks someone who still needs orientation above someone whose task is done, other things equal", () => {
    const base = person("E0064");
    const needs = { ...base, employeeId: "E9998", orientationTaskDone: false };
    const done = { ...base, employeeId: "E9997", orientationTaskDone: true };
    expect(sortPeople([done, needs], "attention").map((p) => p.employeeId)).toEqual(["E9998", "E9997"]);
  });
});
