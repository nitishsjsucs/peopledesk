import { describe, expect, it } from "vitest";
import { containsAllValues, extractNumbers, normalizeValue, stripIdsAndDates } from "../../evals/lib/normalize.ts";

describe("number normalization", () => {
  it("canonicalizes numerals, money, percentages and decimals", () => {
    expect(extractNumbers("1.5")).toEqual(["1.5"]);
    expect(extractNumbers("1.50 days per month")).toEqual(["1.5"]);
    expect(extractNumbers("The cap is $1,500.")).toEqual(["1500"]);
    expect(extractNumbers("15% of eligible pay")).toEqual(["15"]);
    expect(extractNumbers("accrues at 2.0 days")).toEqual(["2"]);
  });

  it("converts number words", () => {
    expect(extractNumbers("one and a half days")).toEqual(["1.5"]);
    expect(extractNumbers("four thousand five hundred dollars")).toEqual(["4500"]);
    expect(extractNumbers("twenty-five hours")).toEqual(["25"]);
    expect(extractNumbers("two hundred and fifty")).toEqual(["250"]);
    expect(extractNumbers("twice a year")).toEqual(["2"]);
    expect(extractNumbers("someone often attends")).toEqual([]);
  });

  it("ignores ids, dates, timestamps and version labels", () => {
    const text =
      "Source: PTO Accrual (POL-014 v3, effective 2026-01-01). Ticket TKT-000151 for E0042 on ORI-003, " +
      "passage POL-014@3#2, at 2026-10-15T15:00:00.000Z, task ONB-E0042-07, id 3f1b2c3d-1111-4222-8333-123456789abc";
    expect(extractNumbers(text)).toEqual([]);
    expect(stripIdsAndDates("policies/r2-managers/POL-018/v02.md")).not.toMatch(/\d/);
  });

  it("matches expected values against answer text", () => {
    expect(normalizeValue("$4,500")).toBe("4500");
    expect(containsAllValues("You accrue one and a half days per month (POL-014 v3).", ["1.5"])).toBe(true);
    expect(containsAllValues("You accrue 1.25 days per month.", ["1.5"])).toBe(false);
    expect(containsAllValues("See POL-003 v3.", ["3"])).toBe(false);
  });
});
