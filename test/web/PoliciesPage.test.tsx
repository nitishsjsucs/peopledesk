import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessDateContext } from "../../src/web/lib/business-date.tsx";
import { PoliciesPage } from "../../src/web/pages/PoliciesPage.tsx";
import { installFetch } from "./fixtures.ts";
import type { Route } from "./fixtures.ts";
import { LocationProbe } from "./probe.tsx";
import { policyChangesFor } from "./seed.ts";

const policy = (docId: string, title: string, category = "benefits") => ({
  docId,
  title,
  category,
  audience: "all",
  currentVersion: 2,
  effectiveFrom: "2026-06-01",
  updatedAt: "2026-06-01",
});

const renderAt = (url = "/policies", asOf: string | null = "2026-10-01") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <BusinessDateContext.Provider value={{ asOf, settled: true }}>
        <PoliciesPage />
        <LocationProbe />
      </BusinessDateContext.Provider>
    </MemoryRouter>,
  );

const changesRoute = (body: unknown = policyChangesFor(1), status = 200): Route => ({ path: /^\/api\/policy-changes/, status, body });
const listCalls = (calls: Array<{ path: string }>) => calls.filter((c) => c.path.startsWith("/api/policies")).map((c) => c.path);

afterEach(() => {
  vi.useRealTimers();
});

describe("PoliciesPage", () => {
  it("restores the search and category from the URL and asks for the filtered list", async () => {
    const calls = installFetch([changesRoute(policyChangesFor(1, "benefits")), { path: "/api/policies?category=benefits&q=stipend", body: { documents: [policy("POL-014", "Wellness Stipend")] } }]);
    renderAt("/policies?q=stipend&category=benefits");
    await within(await screen.findByTestId("policy-list")).findByRole("link", { name: "Wellness Stipend" });
    expect((screen.getByLabelText("Search titles") as HTMLInputElement).value).toBe("stipend");
    expect((screen.getByLabelText("Category") as HTMLSelectElement).value).toBe("benefits");
    expect(listCalls(calls)).toEqual(["/api/policies?category=benefits&q=stipend"]);
    // Policy changes follow the category, not the search.
    expect(calls.filter((c) => c.path.startsWith("/api/policy-changes")).map((c) => c.path)).toEqual(["/api/policy-changes?category=benefits"]);
  });

  it("asks for the list at most twice while seven characters are typed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const calls = installFetch([changesRoute(), { path: /^\/api\/policies/, body: { documents: [policy("POL-014", "Wellness Stipend")] } }]);
    renderAt();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const input = screen.getByLabelText("Search titles");
    let typed = "";
    for (const ch of "stipend") {
      typed += ch;
      fireEvent.change(input, { target: { value: typed } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    const lists = calls.filter((c) => c.path.startsWith("/api/policies"));
    expect(lists.length).toBeLessThanOrEqual(2);
    expect(lists.map((c) => c.path)).toEqual(["/api/policies", "/api/policies?q=stipend"]);
    expect(screen.getByTestId("location").textContent).toBe("/policies?q=stipend");
  });

  it("offers to clear the filters or ask in chat when nothing matches, with no empty list under it", async () => {
    installFetch([
      changesRoute(),
      { path: "/api/policies?category=conduct&q=zebra", body: { documents: [] } },
      { path: "/api/policies", body: { documents: [policy("POL-014", "Wellness Stipend")] } },
    ]);
    renderAt("/policies?q=zebra&category=conduct");
    await screen.findByText("No policies match");
    expect(screen.queryByTestId("policy-list")).toBeNull();
    expect(screen.getByRole("link", { name: "Ask in chat" }).getAttribute("href")).toBe("/chat");
    const clear = screen.getByRole("button", { name: "Clear filters" });
    clear.focus();
    fireEvent.click(clear);
    await screen.findByRole("link", { name: "Wellness Stipend" });
    expect(screen.getByTestId("location").textContent).toBe("/policies");
    // The button is gone with the empty state, so focus is on the search box, not on the page.
    expect(document.activeElement).toBe(screen.getByLabelText("Search titles"));
    expect((screen.getByLabelText("Search titles") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Category") as HTMLSelectElement).value).toBe("");
  });

  it("shows a loading line while the list loads", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    installFetch([changesRoute(), { path: "/api/policies", body: async () => (await held, { documents: [policy("POL-014", "Wellness Stipend")] }) }]);
    renderAt();
    expect(screen.getAllByRole("status").map((x) => x.textContent)).toContain("Loading policies...");
    release();
    await screen.findByRole("link", { name: "Wellness Stipend" });
  });
});

describe("PoliciesPage policy changes", () => {
  const coming = () => screen.getByTestId("changes-coming-up");
  const recent = () => screen.getByTestId("changes-recent");
  const items = (group: HTMLElement) => within(group).getAllByRole("listitem");

  it("lists what is coming up, soonest first, and what took effect lately, newest first, four of each", async () => {
    installFetch([changesRoute(), { path: "/api/policies", body: { documents: [policy("POL-014", "Wellness Stipend")] } }]);
    renderAt();
    expect(await screen.findByRole("heading", { level: 2, name: "Policy changes" })).toBeTruthy();
    expect(within(coming()).getByRole("heading", { level: 3 }).textContent).toBe("Coming up (8)");
    expect(within(recent()).getByRole("heading", { level: 3 }).textContent).toBe("Took effect in the last 90 days (10)");
    expect(items(coming())).toHaveLength(4);
    const first = items(coming())[0]!;
    expect(first.querySelector(".change-when")?.textContent).toBe("Jan 1, 2027, in 92 days");
    expect(within(first).getByRole("link", { name: "Lost Device Reporting" }).getAttribute("href")).toBe("/policies/POL-057/v/2");
    expect(first.textContent).toContain("version 1 to 2");
    expect(items(coming())[1]?.textContent).toContain("Orientation Attendance");
    expect(items(recent()).map((li) => li.querySelector(".change-what a")?.textContent)).toEqual([
      "Bereavement Leave",
      "Employee Assistance Program",
      "Recognition Program",
      "Lodging Limits",
    ]);
    expect(items(recent())[0]?.querySelector(".change-when")?.textContent).toBe("Oct 1, 2026, today");
    expect(items(recent())[1]?.textContent).toContain("new policy");
    expect(items(recent())[3]?.querySelector(".change-when")?.textContent).toBe("Sep 1, 2026, 30 days ago");
  });

  it("shows the rest of a group with Show all, which says whether it is expanded", async () => {
    installFetch([changesRoute(), { path: "/api/policies", body: { documents: [] } }]);
    renderAt();
    const more = await within(await screen.findByTestId("changes-coming-up")).findByRole("button", { name: "Show all 8" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(more.getAttribute("aria-controls")).toBe(within(coming()).getByRole("list").id);
    fireEvent.click(more);
    expect(items(coming())).toHaveLength(8);
    expect(within(coming()).getByRole("button", { name: "Show fewer" }).getAttribute("aria-expanded")).toBe("true");
    for (const li of items(coming())) expect(within(li).getByRole("link").getAttribute("href")).toMatch(/^\/policies\/POL-\d{3}\/v\/\d+$/);
  });

  it("follows the category, and names it when nothing changed", async () => {
    const calls = installFetch([
      { path: "/api/policy-changes?category=performance", body: { asOf: "2026-10-01", changes: [], truncated: false } },
      { path: "/api/policy-changes", body: policyChangesFor(1) },
      { path: /^\/api\/policies/, body: { documents: [] } },
    ]);
    renderAt();
    await screen.findByTestId("changes-coming-up");
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "performance" } });
    expect((await screen.findByTestId("policy-changes-empty")).textContent).toBe("No Performance policy changes in the last 90 days or scheduled in the next year.");
    expect(calls.filter((c) => c.path.startsWith("/api/policy-changes")).map((c) => c.path)).toEqual(["/api/policy-changes", "/api/policy-changes?category=performance"]);
  });

  it("says so without a category name when nothing changed at all", async () => {
    installFetch([changesRoute({ asOf: "2026-10-01", changes: [], truncated: false }), { path: "/api/policies", body: { documents: [] } }]);
    renderAt();
    expect((await screen.findByTestId("policy-changes-empty")).textContent).toBe("No policy changes in the last 90 days or scheduled in the next year.");
  });

  it("shows a loading line, then an error with Try again, while the policy list still renders", async () => {
    let fail = true;
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    installFetch([
      { path: "/api/policy-changes", status: () => (fail ? 500 : 200), body: async () => (await held, fail ? { error: { code: "internal", message: "Internal error.", requestId: "r" } } : policyChangesFor(1)) },
      { path: "/api/policies", body: { documents: [policy("POL-014", "Wellness Stipend")] } },
    ]);
    renderAt();
    expect(within(screen.getByTestId("policy-changes")).getByRole("status").textContent).toBe("Loading policy changes...");
    release();
    const alert = await within(screen.getByTestId("policy-changes")).findByRole("alert");
    expect(alert.textContent).toContain("Could not load policy changes. Internal error.");
    expect(screen.getByRole("link", { name: "Wellness Stipend" })).toBeTruthy();
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("changes-coming-up")).toBeTruthy();
  });

  it("dates changes without how soon when the business date is unknown, and notes a truncated list", async () => {
    const body = { ...policyChangesFor(3), truncated: true };
    installFetch([changesRoute(body), { path: "/api/policies", body: { documents: [] } }]);
    renderAt("/policies", null);
    const first = items(await screen.findByTestId("changes-coming-up"))[0]!;
    expect(first.querySelector(".change-when")?.textContent).toBe("Jan 1, 2027");
    await waitFor(() => expect(screen.getByText("Showing the first 50 changes.")).toBeTruthy());
  });
});
