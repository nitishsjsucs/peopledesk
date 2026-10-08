import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown, parseBlocks } from "../../src/web/lib/markdown.tsx";

const DOC = `---
doc_id: POL-014
version: 3
---
# PTO Accrual
Effective from 2026-01-01. Applies to: all employees.
## Policy
- Paid time off accrues at **1.5 days** per month.
- Use \`Form PD-412\`.
## Procedure
File requests through the HR portal.
`;

describe("restricted markdown renderer", () => {
  it("renders headings, lists and paragraphs and skips front matter", () => {
    const { container } = render(<Markdown source={DOC} />);
    expect(container.querySelector("h1")?.textContent).toBe("PTO Accrual");
    expect([...container.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Policy", "Procedure"]);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("li strong")?.textContent).toBe("1.5 days");
    expect(container.querySelector("li code")?.textContent).toBe("Form PD-412");
    expect(container.textContent).not.toContain("doc_id");
    expect(parseBlocks(DOC).map((b) => b.type)).toEqual(["h1", "p", "h2", "ul", "h2", "p"]);
  });

  it("never injects raw HTML", () => {
    const hostile = `# Title <img src=x onerror=alert(1)>\n<script>alert(1)</script>\n- <b>bold</b> **<i>x</i>**\n<a href="javascript:alert(1)">click</a>`;
    const { container } = render(<Markdown source={hostile} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("i")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.querySelector("h1")?.textContent).toBe("Title <img src=x onerror=alert(1)>");
  });
});
