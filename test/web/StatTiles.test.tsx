import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { StatTiles } from "../../src/web/components/StatTiles.tsx";
import type { Tile } from "../../src/web/components/StatTiles.tsx";

const tiles: Tile[] = [
  { key: "all", count: 30, label: "in onboarding", icon: "people" },
  { key: "unbooked", count: 12, label: "not booked", icon: "calendar" },
  { key: "blocked", count: 1, label: "with blocked tasks", icon: "blocked" },
  { key: "overdue", count: 0, label: "with overdue tasks", icon: "clock" },
];

describe("StatTiles in filter mode", () => {
  it("renders pressable buttons in a named group, named by the visible number and label first, then the noun", () => {
    const onSelect = vi.fn();
    render(<StatTiles mode="filter" label="Show" tiles={tiles} selected="all" onSelect={onSelect} />);
    const group = screen.getByRole("group", { name: "Show" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
    expect(screen.getByRole("button", { name: "30 in onboarding, 30 people" })).toBe(buttons[0]);
    expect(screen.getByRole("button", { name: "12 not booked, 12 people" })).toBe(buttons[1]);
    expect(screen.getByRole("button", { name: "1 with blocked tasks, 1 person" })).toBe(buttons[2]);
    fireEvent.click(buttons[1]!);
    expect(onSelect).toHaveBeenCalledWith("unbooked");
  });

  it("shows a zero count as 0, still pressable, and every icon is hidden from assistive technology", () => {
    const onSelect = vi.fn();
    const { container } = render(<StatTiles mode="filter" label="Show" tiles={tiles} selected="overdue" onSelect={onSelect} />);
    const zero = screen.getByRole("button", { name: "0 with overdue tasks, 0 people" });
    expect(zero.querySelector(".stat-value")?.textContent).toBe("0");
    expect(zero.getAttribute("aria-pressed")).toBe("true");
    expect((zero as HTMLButtonElement).disabled).toBe(false);
    for (const svg of container.querySelectorAll("svg")) expect(svg.getAttribute("aria-hidden")).toBe("true");
  });
});

/** What a sighted user sees on a tile, in order: the number, then the label (capitalized only by CSS). */
const visibleText = (el: Element) => `${el.querySelector(".stat-value")?.textContent} ${el.querySelector(".stat-label")?.textContent}`;

describe("StatTiles names (WCAG 2.5.3 Label in Name)", () => {
  it("starts every button's and link's name with its visible number and label, in that order", () => {
    render(
      <MemoryRouter>
        <StatTiles mode="filter" label="Show" tiles={tiles} selected="all" onSelect={() => {}} />
        <StatTiles mode="link" label="Links" tiles={tiles.map((t) => ({ ...t, hint: ", show them", href: `/onboarding?show=${t.key}` }))} />
      </MemoryRouter>,
    );
    const controls = [...screen.getAllByRole("button"), ...screen.getAllByRole("link")];
    expect(controls).toHaveLength(8);
    for (const c of controls) {
      const name = c.getAttribute("aria-label") ?? "";
      expect(name.startsWith(visibleText(c)), `${name} | ${visibleText(c)}`).toBe(true);
    }
  });

  it("uses the noun given for what is counted, singular for one", () => {
    render(<StatTiles mode="filter" label="Status" tiles={[{ key: "open", count: 1, label: "open", icon: "clock", noun: ["ticket", "tickets"] }]} selected="open" onSelect={() => {}} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe("1 open, 1 ticket");
  });
});

describe("StatTiles in link mode", () => {
  it("renders links with the given hrefs and a hint read after the label", () => {
    render(
      <MemoryRouter>
        <StatTiles
          mode="link"
          label="People in onboarding"
          tiles={[
            { key: "unbooked", count: 3, label: "not booked", hint: " who need orientation, show them", icon: "calendar", href: "/onboarding?show=unbooked" },
            { key: "blocked", count: 0, label: "with blocked tasks", hint: ", show them", icon: "check", href: "/onboarding?show=blocked" },
          ]}
        />
      </MemoryRouter>,
    );
    const list = screen.getByRole("list", { name: "People in onboarding" });
    const links = within(list).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/onboarding?show=unbooked", "/onboarding?show=blocked"]);
    expect(screen.getByRole("link", { name: "3 not booked, 3 people who need orientation, show them" })).toBe(links[0]);
    expect(screen.getByRole("link", { name: "0 with blocked tasks, 0 people, show them" }).querySelector(".stat-value")?.textContent).toBe("0");
  });
});
