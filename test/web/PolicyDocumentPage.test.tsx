import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { BusinessDateContext } from "../../src/web/lib/business-date.tsx";
import { PolicyDocumentPage } from "../../src/web/pages/PolicyDocumentPage.tsx";
import { installFetch } from "./fixtures.ts";

const doc = {
  docId: "POL-014",
  title: "Wellness Stipend",
  category: "benefits",
  audience: "all",
  versions: [
    { version: 1, effectiveFrom: "2025-06-01", effectiveTo: "2026-06-01", status: "superseded", changeSummary: "Initial version." },
    { version: 2, effectiveFrom: "2026-06-01", effectiveTo: "2027-03-01", status: "current", changeSummary: "Maximum annual wellness stipend changed from $1,500 to $275." },
    { version: 3, effectiveFrom: "2027-03-01", effectiveTo: null, status: "scheduled", changeSummary: "Maximum annual wellness stipend changed from $275 to $1,400." },
  ],
};
const STIPEND = { 1: "$1,500", 2: "$275", 3: "$1,400" } as const;
const versionBody = (v: (typeof doc.versions)[number]) => ({
  meta: { ...v, docId: doc.docId, title: doc.title, category: doc.category, audience: doc.audience },
  markdown:
    `---\ndoc_id: POL-014\n---\n# Wellness Stipend\nEffective from ${v.effectiveFrom}. Applies to: all employees.\n` +
    `## Policy\n- Version ${v.version} text.\n- The maximum annual wellness stipend is ${STIPEND[v.version as 1 | 2 | 3]}.\n- Unchanged line.\n`,
  r2Key: `policies/r1-all/POL-014/v0${v.version}.md`,
});

function renderAtWithCalls(path: string) {
  const calls = installFetch([
    { path: "/api/policies/POL-014", body: doc },
    ...doc.versions.map((v) => ({ path: `/api/policies/POL-014/versions/${v.version}`, body: versionBody(v) })),
    { path: /\/api\/policies\/POL-014\/versions\/\d+$/, status: 404, body: { error: { code: "not_found", message: "Version not found.", requestId: "r" } } },
  ]);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/policies/:docId" element={<PolicyDocumentPage />} />
        <Route path="/policies/:docId/v/:version" element={<PolicyDocumentPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return () => calls;
}

function renderAt(path: string) {
  installFetch([
    { path: "/api/policies/POL-014", body: doc },
    ...doc.versions.map((v) => ({ path: `/api/policies/POL-014/versions/${v.version}`, body: versionBody(v) })),
    { path: /\/api\/policies\/POL-014\/versions\/\d+$/, status: 404, body: { error: { code: "not_found", message: "Version not found.", requestId: "r" } } },
  ]);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/policies/:docId" element={<PolicyDocumentPage />} />
        <Route path="/policies/:docId/v/:version" element={<PolicyDocumentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PolicyDocumentPage", () => {
  it("shows the current version by default with timeline badges and effective dates", async () => {
    const { container } = renderAt("/policies/POL-014");
    await screen.findByText("Version 2 text.", { selector: ".markdown li" });
    const timeline = screen.getByRole("list", { name: "Version history" });
    const items = within(timeline).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-status"))).toEqual(["scheduled", "current", "superseded"]);
    expect(items[0]?.textContent).toContain("effective Mar 1, 2027");
    expect(items[2]?.textContent).toContain("effective Jun 1, 2025 until Jun 1, 2026");
    // The current version is not marked superseded; it notes the scheduled version instead.
    expect(container.querySelector(".superseded-note")?.getAttribute("data-testid")).toBe("scheduled-note");
  });

  it("notes on the current version when a scheduled version takes effect, with a link to it", async () => {
    renderAt("/policies/POL-014");
    const note = await screen.findByTestId("scheduled-note");
    expect(note.textContent).toBe("Version 3 takes effect on Mar 1, 2027.");
    expect(within(note).getByRole("link", { name: "Version 3" }).getAttribute("href")).toBe("/policies/POL-014/v/3");
  });

  it("says a malformed version does not exist, links to the current one, and offers no retry", async () => {
    const calls = renderAtWithCalls("/policies/POL-014/v/abc");
    expect((await screen.findByTestId("version-missing")).textContent).toBe("Version abc of POL-014 does not exist.");
    expect(screen.getByRole("link", { name: "See the current version" }).getAttribute("href")).toBe("/policies/POL-014/v/2");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByText("Loading...")).toBeNull();
    expect(calls().some((c) => c.path.includes("/versions/"))).toBe(false);
  });

  it("says a version number the document does not have does not exist, even when its body answers 404", async () => {
    renderAt("/policies/POL-014/v/99");
    expect((await screen.findByTestId("version-missing")).textContent).toBe("Version 99 of POL-014 does not exist.");
    expect(screen.getByRole("link", { name: "See the current version" }).getAttribute("href")).toBe("/policies/POL-014/v/2");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("answers 'Policy not found' for a document the reader cannot see", async () => {
    installFetch([{ path: "/api/policies/POL-099", status: 404, body: { error: { code: "not_found", message: "Policy not found.", requestId: "r" } } }]);
    render(
      <MemoryRouter initialEntries={["/policies/POL-099"]}>
        <Routes>
          <Route path="/policies/:docId" element={<PolicyDocumentPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Policy not found" })).toBeTruthy();
  });

  it("lists what changed from the previous version", async () => {
    renderAt("/policies/POL-014/v/2");
    const diff = await screen.findByTestId("version-diff");
    expect(diff.querySelector("summary")?.textContent).toBe("Changes from version 1");
    const removed = [...diff.querySelectorAll(".diff-removed")].map((li) => li.textContent);
    const added = [...diff.querySelectorAll(".diff-added")].map((li) => li.textContent);
    expect(removed).toEqual(["Removed: - Version 1 text.", "Removed: - The maximum annual wellness stipend is $1,500."]);
    expect(added).toEqual(["Added: + Version 2 text.", "Added: + The maximum annual wellness stipend is $275."]);
    expect(diff.textContent).not.toContain("Unchanged line");
    expect(diff.textContent).not.toContain("Effective from");
  });

  it("shows no change list for the first version", async () => {
    renderAt("/policies/POL-014/v/1");
    await screen.findByText("Version 1 text.", { selector: ".markdown li" });
    expect(screen.queryByTestId("version-diff")).toBeNull();
  });

  it("marks a superseded version visibly and links to the current one", async () => {
    renderAt("/policies/POL-014/v/1");
    await screen.findByText("Version 1 text.", { selector: ".markdown li" });
    const note = screen.getByRole("note");
    expect(note.textContent).toContain("superseded on Jun 1, 2026");
    expect(within(note).getByRole("link").getAttribute("href")).toBe("/policies/POL-014/v/2");
  });

  it("marks a scheduled version as not yet in effect", async () => {
    renderAt("/policies/POL-014/v/3");
    await screen.findByText("Version 3 text.", { selector: ".markdown li" });
    expect(screen.getByRole("note").textContent).toContain("takes effect on Mar 1, 2027");
  });

  it("marks today between the scheduled and current versions, and how soon the scheduled one takes effect", async () => {
    installFetch([
      { path: "/api/policies/POL-014", body: doc },
      ...doc.versions.map((v) => ({ path: `/api/policies/POL-014/versions/${v.version}`, body: versionBody(v) })),
    ]);
    render(
      <MemoryRouter initialEntries={["/policies/POL-014"]}>
        <BusinessDateContext.Provider value={{ asOf: "2026-10-01", settled: true }}>
          <Routes>
            <Route path="/policies/:docId" element={<PolicyDocumentPage />} />
          </Routes>
        </BusinessDateContext.Provider>
      </MemoryRouter>,
    );
    await screen.findByText("Version 2 text.", { selector: ".markdown li" });
    const items = within(screen.getByRole("list", { name: "Version history" })).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-status"))).toEqual(["scheduled", "today", "current", "superseded"]);
    expect(items[1]?.textContent).toBe("Today: Oct 1, 2026");
    expect(items[0]?.querySelector(".timeline-when")?.textContent).toBe("in 151 days");
    expect(items[2]?.querySelector(".timeline-when")).toBeNull();
  });

  it("shows no Today item without a business date", async () => {
    renderAt("/policies/POL-014");
    await screen.findByText("Version 2 text.", { selector: ".markdown li" });
    const timeline = screen.getByRole("list", { name: "Version history" });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(3);
    expect(timeline.textContent).not.toContain("Today");
    expect(timeline.querySelector(".timeline-when")).toBeNull();
  });
});
