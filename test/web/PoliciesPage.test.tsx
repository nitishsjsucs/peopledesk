import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PoliciesPage } from "../../src/web/pages/PoliciesPage.tsx";
import { installFetch } from "./fixtures.ts";
import { LocationProbe } from "./probe.tsx";

const policy = (docId: string, title: string, category = "benefits") => ({
  docId,
  title,
  category,
  audience: "all",
  currentVersion: 2,
  effectiveFrom: "2026-06-01",
  updatedAt: "2026-06-01",
});

const renderAt = (url = "/policies") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <PoliciesPage />
      <LocationProbe />
    </MemoryRouter>,
  );

afterEach(() => {
  vi.useRealTimers();
});

describe("PoliciesPage", () => {
  it("restores the search and category from the URL and asks for the filtered list", async () => {
    const calls = installFetch([{ path: "/api/policies?category=benefits&q=stipend", body: { documents: [policy("POL-014", "Wellness Stipend")] } }]);
    renderAt("/policies?q=stipend&category=benefits");
    await screen.findByRole("link", { name: "Wellness Stipend" });
    expect((screen.getByLabelText("Search titles") as HTMLInputElement).value).toBe("stipend");
    expect((screen.getByLabelText("Category") as HTMLSelectElement).value).toBe("benefits");
    expect(calls.map((c) => c.path)).toEqual(["/api/policies?category=benefits&q=stipend"]);
  });

  it("asks for the list at most twice while seven characters are typed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const calls = installFetch([{ path: /^\/api\/policies/, body: { documents: [policy("POL-014", "Wellness Stipend")] } }]);
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
      { path: "/api/policies?category=conduct&q=zebra", body: { documents: [] } },
      { path: "/api/policies", body: { documents: [policy("POL-014", "Wellness Stipend")] } },
    ]);
    renderAt("/policies?q=zebra&category=conduct");
    await screen.findByText("No policies match");
    expect(screen.queryByTestId("policy-list")).toBeNull();
    expect(screen.getByRole("link", { name: "Ask in chat" }).getAttribute("href")).toBe("/chat");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByRole("link", { name: "Wellness Stipend" });
    expect(screen.getByTestId("location").textContent).toBe("/policies");
    expect((screen.getByLabelText("Search titles") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Category") as HTMLSelectElement).value).toBe("");
  });

  it("shows a loading line while the list loads", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    installFetch([{ path: "/api/policies", body: async () => (await held, { documents: [policy("POL-014", "Wellness Stipend")] }) }]);
    renderAt();
    expect(screen.getByRole("status").textContent).toBe("Loading policies...");
    release();
    await screen.findByRole("link", { name: "Wellness Stipend" });
  });
});
