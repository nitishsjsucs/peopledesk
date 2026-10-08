import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
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
const versionBody = (v: (typeof doc.versions)[number]) => ({
  meta: { ...v, docId: doc.docId, title: doc.title, category: doc.category, audience: doc.audience },
  markdown: `---\ndoc_id: POL-014\n---\n# Wellness Stipend\n## Policy\n- Version ${v.version} text.\n`,
  r2Key: `policies/r1-all/POL-014/v0${v.version}.md`,
});

function renderAt(path: string) {
  installFetch([
    { path: "/api/policies/POL-014", body: doc },
    ...doc.versions.map((v) => ({ path: `/api/policies/POL-014/versions/${v.version}`, body: versionBody(v) })),
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
    await screen.findByText("Version 2 text.");
    const timeline = screen.getByRole("list", { name: "Version history" });
    const items = within(timeline).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-status"))).toEqual(["scheduled", "current", "superseded"]);
    expect(items[0]?.textContent).toContain("effective Mar 1, 2027");
    expect(items[2]?.textContent).toContain("effective Jun 1, 2025 until Jun 1, 2026");
    expect(container.querySelector(".superseded-note")).toBeNull();
  });

  it("marks a superseded version visibly and links to the current one", async () => {
    renderAt("/policies/POL-014/v/1");
    await screen.findByText("Version 1 text.");
    const note = screen.getByRole("note");
    expect(note.textContent).toContain("superseded on Jun 1, 2026");
    expect(within(note).getByRole("link").getAttribute("href")).toBe("/policies/POL-014/v/2");
  });

  it("marks a scheduled version as not yet in effect", async () => {
    renderAt("/policies/POL-014/v/3");
    await screen.findByText("Version 3 text.");
    expect(screen.getByRole("note").textContent).toContain("takes effect on Mar 1, 2027");
  });
});
