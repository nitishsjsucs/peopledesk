import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EffectiveDateBadge } from "../../src/web/components/EffectiveDateBadge.tsx";
import { formatMoney, formatRelativeExpiry } from "../../src/web/lib/format.ts";

describe("EffectiveDateBadge", () => {
  it("shows an open-ended current version", () => {
    render(<EffectiveDateBadge effectiveFrom="2026-01-01" effectiveTo={null} status="current" />);
    const badge = screen.getByTestId("effective-date-badge");
    expect(badge.textContent).toContain("Current");
    expect(badge.textContent).toContain("effective Jan 1, 2026");
    expect(badge.querySelector("time")?.getAttribute("dateTime")).toBe("2026-01-01");
  });

  it("shows the end of a superseded version's range", () => {
    render(<EffectiveDateBadge effectiveFrom="2025-03-01" effectiveTo="2026-01-01" status="superseded" />);
    expect(screen.getByTestId("effective-date-badge").textContent).toContain(
      "Supersededeffective Mar 1, 2025 until Jan 1, 2026",
    );
  });
});

describe("format helpers", () => {
  it("formats money with grouping", () => {
    expect(formatMoney(1500)).toBe("$1,500");
    expect(formatMoney(12.5)).toBe("$12.50");
  });

  it("formats relative expiry", () => {
    const now = Date.parse("2026-10-01T00:00:00Z");
    expect(formatRelativeExpiry("2026-10-01T00:14:59Z", now)).toBe("14 min");
    expect(formatRelativeExpiry("2026-10-01T00:00:30Z", now)).toBe("30 s");
    expect(formatRelativeExpiry("2026-09-30T00:00:00Z", now)).toBe("expired");
  });
});
