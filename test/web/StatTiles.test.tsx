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
  it("renders pressable buttons in a named group, named by number, noun and label", () => {
    const onSelect = vi.fn();
    render(<StatTiles mode="filter" label="Show" tiles={tiles} selected="all" onSelect={onSelect} />);
    const group = screen.getByRole("group", { name: "Show" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
    expect(screen.getByRole("button", { name: "30 people in onboarding" })).toBe(buttons[0]);
    expect(screen.getByRole("button", { name: "12 people not booked" })).toBe(buttons[1]);
    expect(screen.getByRole("button", { name: "1 person with blocked tasks" })).toBe(buttons[2]);
    fireEvent.click(buttons[1]!);
    expect(onSelect).toHaveBeenCalledWith("unbooked");
  });

  it("shows a zero count as 0, still pressable, and every icon is hidden from assistive technology", () => {
    const onSelect = vi.fn();
    const { container } = render(<StatTiles mode="filter" label="Show" tiles={tiles} selected="overdue" onSelect={onSelect} />);
    const zero = screen.getByRole("button", { name: "0 people with overdue tasks" });
    expect(zero.querySelector(".stat-value")?.textContent).toBe("0");
    expect(zero.getAttribute("aria-pressed")).toBe("true");
    expect((zero as HTMLButtonElement).disabled).toBe(false);
    for (const svg of container.querySelectorAll("svg")) expect(svg.getAttribute("aria-hidden")).toBe("true");
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
            { key: "unbooked", count: 3, label: "not booked", hint: " for orientation, show them", icon: "calendar", href: "/onboarding?show=unbooked" },
            { key: "blocked", count: 0, label: "with blocked tasks", hint: ", show them", icon: "check", href: "/onboarding?show=blocked" },
          ]}
        />
      </MemoryRouter>,
    );
    const list = screen.getByRole("list", { name: "People in onboarding" });
    const links = within(list).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/onboarding?show=unbooked", "/onboarding?show=blocked"]);
    expect(screen.getByRole("link", { name: "3 people not booked for orientation, show them" })).toBe(links[0]);
    expect(screen.getByRole("link", { name: "0 people with blocked tasks, show them" }).querySelector(".stat-value")?.textContent).toBe("0");
  });
});
