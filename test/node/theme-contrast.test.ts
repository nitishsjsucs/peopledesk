// WCAG contrast of the theme tokens in src/web/styles.css: primary button text and the faint text color
// must reach 4.5:1 (normal text, AA) in the light theme, and primary button text in the dark theme.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Comments are dropped first, so a comment inside a rule never reads as part of a declaration.
const css = readFileSync(new URL("../../src/web/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const m = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  if (!m) throw new Error(`no rule ${selector}`);
  const out: Record<string, string> = {};
  for (const decl of (m[1] ?? "").split(";")) {
    const i = decl.indexOf(":");
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
}

/** Every rule whose selector list is exactly `selector`, in file order. */
function rules(selector: string): Array<Record<string, string>> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const re = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "gm");
  return [...css.matchAll(re)].map((m) => {
    const out: Record<string, string> = {};
    for (const decl of (m[1] ?? "").split(";")) {
      const i = decl.indexOf(":");
      if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
    return out;
  });
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const light = rule(":root");
const dark = rule(':root[data-theme="dark"]');
/** The dark tokens that follow the OS setting, inside @media (prefers-color-scheme: dark). */
const darkMedia = (() => {
  const m = /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/.exec(css);
  if (!m) throw new Error("no dark media block");
  const out: Record<string, string> = {};
  for (const decl of (m[1] ?? "").split(";")) {
    const i = decl.indexOf(":");
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
})();

const CHART_TOKENS = ["--chart-done", "--chart-overdue", "--chart-track"] as const;

describe("theme contrast (styles.css)", () => {
  it("computes contrast like WCAG", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#1c2230", "#2556c7")).toBeLessThan(3); // the old light primary button text
  });

  it("light primary buttons have white text on --primary and --primary-hover", () => {
    for (const bg of [light["--primary"], light["--primary-hover"]]) expect(contrast("#ffffff", bg as string)).toBeGreaterThanOrEqual(4.5);
  });

  it("light --text-faint is readable on --surface, --bg and --surface-muted", () => {
    for (const bg of ["--surface", "--bg", "--surface-muted"]) {
      expect(contrast(light["--text-faint"] as string, light[bg] as string), bg).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("dark primary button text is readable on the dark --primary", () => {
    const darkButton = rule(':root[data-theme="dark"] .btn-primary,\n:root[data-theme="dark"] .message-user');
    expect(contrast(darkButton["color"] as string, dark["--primary"] as string)).toBeGreaterThanOrEqual(4.5);
  });

  it("the .btn-primary rule that sets the background also sets the text color, so .btn cannot override it", () => {
    const withBackground = rules(".btn-primary").filter((r) => r["background"]);
    expect(withBackground).toHaveLength(1);
    expect(withBackground[0]?.["color"]).toBe("#fff");
    // .btn (same specificity) must come before that rule for it to win.
    expect(css.indexOf("\n.btn {")).toBeLessThan(css.search(/\n\.btn-primary \{\s*background/));
  });

  it("defines the chart tokens in :root, the dark media block and [data-theme=dark], with the two dark blocks agreeing", () => {
    for (const t of CHART_TOKENS) {
      expect(light[t], t).toMatch(/^#[0-9a-f]{6}$/);
      expect(dark[t], t).toMatch(/^#[0-9a-f]{6}$/);
      expect(darkMedia[t], t).toBe(dark[t]);
    }
    expect(CHART_TOKENS.map((t) => light[t])).toEqual(["#2556c7", "#9a5b00", "#d9dde4"]);
    expect(CHART_TOKENS.map((t) => dark[t])).toEqual(["#5a88ee", "#c4862a", "#3d4757"]);
  });

  it("done and overdue marks reach 3:1 against --surface in both themes", () => {
    for (const theme of [light, dark]) {
      for (const t of ["--chart-done", "--chart-overdue"]) {
        expect(contrast(theme[t] as string, theme["--surface"] as string), t).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
