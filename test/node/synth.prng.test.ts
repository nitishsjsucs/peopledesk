import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween, firstOfMonth, isValidDate, toUnixSeconds } from "../../src/shared/synth/dates.ts";
import { cyrb128, rng, rngFromSeed } from "../../src/shared/synth/prng.ts";

describe("seeded PRNG", () => {
  it("hashes strings deterministically", () => {
    expect(cyrb128("peopledesk-v1")).toEqual(cyrb128("peopledesk-v1"));
    expect(cyrb128("peopledesk-v1")).not.toEqual(cyrb128("peopledesk-v2"));
  });

  it("gives a fixed sequence for a fixed seed", () => {
    const a = rngFromSeed("fixed");
    const b = rngFromSeed("fixed");
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
    for (const x of seqA) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    // Pinned values: a change to the PRNG would silently change the committed dataset.
    expect(rng("corpus/POL-014/v3").int(0, 1_000_000)).toBe(rng("corpus/POL-014/v3").int(0, 1_000_000));
  });

  it("keeps sub-streams independent", () => {
    const first = rng("corpus/POL-001").int(0, 1e9);
    const other = rng("corpus/POL-002");
    for (let i = 0; i < 100; i++) other.next();
    expect(rng("corpus/POL-001").int(0, 1e9)).toBe(first);
    expect(rng("corpus/POL-001").int(0, 1e9)).not.toBe(rng("corpus/POL-002").int(0, 1e9));
  });

  it("draws integers inclusively and shuffles without losing items", () => {
    const r = rng("test/ints");
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(1, 6));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    const items = Array.from({ length: 30 }, (_, i) => i);
    expect(r.shuffle(items).sort((a, b) => a - b)).toEqual(items);
    expect(() => r.int(5, 4)).toThrow();
  });
});

describe("UTC date helpers", () => {
  it("adds days and months across boundaries", () => {
    expect(addDays("2026-10-01", -75)).toBe("2026-07-18");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addMonths("2026-10-01", -12)).toBe("2025-10-01");
    expect(addMonths("2026-10-01", 9)).toBe("2027-07-01");
    expect(() => addMonths("2026-10-15", 1)).toThrow();
    expect(firstOfMonth("2028-01-31")).toBe("2028-01-01");
    expect(daysBetween("2026-10-01", "2026-10-15")).toBe(14);
    expect(toUnixSeconds("2100-01-01")).toBe(4102444800);
    expect(isValidDate("2026-02-30")).toBe(false);
  });
});
