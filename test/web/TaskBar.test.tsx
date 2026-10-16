import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskBar, TaskBarLegend, taskSegments } from "../../src/web/components/TaskBar.tsx";

const segmentsOf = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>(".task-bar .task-seg")].map((el) => [el.dataset["segment"], Number(el.dataset["count"]), Number(el.style.flexGrow)]);

describe("taskSegments", () => {
  it("splits 12 tasks with 7 done and 2 overdue into 7, 2 and 3, adding up to the total", () => {
    const s = taskSegments({ total: 12, done: 7, overdue: 2 });
    expect(s).toEqual([
      { key: "done", count: 7 },
      { key: "overdue", count: 2 },
      { key: "rest", count: 3 },
    ]);
    expect(s.reduce((n, x) => n + x.count, 0)).toBe(12);
  });

  it("leaves out empty segments, and never derives one from a difference that can go negative", () => {
    expect(taskSegments({ total: 12, done: 12, overdue: 0 })).toEqual([{ key: "done", count: 12 }]);
    expect(taskSegments({ total: 12, done: 0, overdue: 0 })).toEqual([{ key: "rest", count: 12 }]);
    expect(taskSegments({ total: 12, done: 3, overdue: 3 })).toEqual([
      { key: "done", count: 3 },
      { key: "overdue", count: 3 },
      { key: "rest", count: 6 },
    ]);
    // Without a business date there is no overdue segment: done and the rest.
    expect(taskSegments({ total: 12, done: 9, overdue: null })).toEqual([
      { key: "done", count: 9 },
      { key: "rest", count: 3 },
    ]);
  });
});

describe("TaskBar", () => {
  it("draws each segment in proportion to its count, named by the visible text line", () => {
    const text = "7 of 12 done · 2 overdue · day 25 of 90";
    const { container } = render(<TaskBar counts={{ total: 12, done: 7, overdue: 2 }} text={text} />);
    expect(segmentsOf(container)).toEqual([
      ["done", 7, 7],
      ["overdue", 2, 2],
      ["rest", 3, 3],
    ]);
    const bar = screen.getByRole("img");
    expect(bar.getAttribute("aria-label")).toBe(text);
    expect(container.querySelector(".task-line")?.textContent).toBe(text);
    expect(screen.getByRole("img", { name: text })).toBe(bar);
  });

  it("renders one segment when everything is done, and a bare track for an empty plan", () => {
    const done = render(<TaskBar counts={{ total: 12, done: 12, overdue: 0 }} text="12 of 12 done" />);
    expect(segmentsOf(done.container)).toEqual([["done", 12, 12]]);
    done.unmount();
    const empty = render(<TaskBar counts={{ total: 0, done: 0, overdue: 0 }} text="0 of 0 done" />);
    expect(empty.container.querySelectorAll(".task-seg")).toHaveLength(1);
    expect(empty.container.querySelector(".task-seg-rest")).toBeTruthy();
  });
});

describe("TaskBarLegend", () => {
  it("names Done, Overdue and Not due yet, each with a swatch", () => {
    render(<TaskBarLegend />);
    const legend = screen.getByRole("list", { name: "Task bar key" });
    const items = within(legend).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Done", "Overdue", "Not due yet"]);
    expect(items.map((li) => li.querySelector(".legend-swatch")?.className)).toEqual([
      "legend-swatch task-seg-done",
      "legend-swatch task-seg-overdue",
      "legend-swatch task-seg-rest",
    ]);
    for (const li of items) expect(li.querySelector(".legend-swatch")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("says Not done instead when overdue cannot be computed", () => {
    render(<TaskBarLegend overdue={false} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Done", "Not done"]);
  });
});
