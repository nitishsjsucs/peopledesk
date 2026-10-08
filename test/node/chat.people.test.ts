import { describe, expect, it } from "vitest";
import type { DirectoryEntry } from "../../src/worker/chat/people.ts";
import { normalizeName, resolvePerson } from "../../src/worker/chat/people.ts";

const me = { employeeId: "E0007", fullName: "Deepa Foster" };
const slice: DirectoryEntry[] = [
  { employeeId: "E0031", fullName: "Priya Patel", inOnboarding: true, booked: false },
  { employeeId: "E0032", fullName: "Rahul Mehta", inOnboarding: true, booked: true },
  { employeeId: "E0033", fullName: "Priya Shah", inOnboarding: false, booked: false },
  { employeeId: "E0034", fullName: "Omar Kim", inOnboarding: true, booked: false },
];

describe("person resolution against the directory slice", () => {
  it("matches full names case-insensitively, with possessives and punctuation", () => {
    expect(resolvePerson("priya patel", me, slice)).toEqual({ kind: "person", employeeId: "E0031" });
    expect(resolvePerson("PRIYA PATEL's", me, slice)).toEqual({ kind: "person", employeeId: "E0031" });
    expect(resolvePerson("  Rahul   Mehta. ", me, slice)).toEqual({ kind: "person", employeeId: "E0032" });
  });

  it("matches a first name only when it is unique in the slice", () => {
    expect(resolvePerson("Omar", me, slice)).toEqual({ kind: "person", employeeId: "E0034" });
    expect(resolvePerson("Priya", me, slice)).toEqual({ kind: "unknown" });
  });

  it("treats the principal's own name and 'me' as self", () => {
    expect(resolvePerson("Deepa Foster", me, slice)).toEqual({ kind: "self" });
    expect(resolvePerson("me", me, slice)).toEqual({ kind: "self" });
    expect(resolvePerson("Deepa", me, slice)).toEqual({ kind: "self" });
  });

  it("gives the same answer for a person who does not exist and one outside the slice", () => {
    const nonexistent = resolvePerson("Zed Nobody", me, slice);
    const outside = resolvePerson("Maya Ghosh", me, slice); // a real employee, not in this slice
    expect(nonexistent).toEqual({ kind: "unknown" });
    expect(outside).toEqual(nonexistent);
    expect(resolvePerson("Priya Patel", me, [])).toEqual({ kind: "unknown" });
  });

  it("normalizes names", () => {
    expect(normalizeName("O'Neil-Smith's ")).toBe("o neil-smith");
  });
});
