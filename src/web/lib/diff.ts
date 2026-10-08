// Line-level change list between two policy versions (front matter and the effective-date line are
// left out: they differ between every pair of versions). Policy bodies are short bullet lists with
// unique lines, so set differences are enough to show what changed.
import { stripFrontMatter } from "./markdown.tsx";

export type LineChange = { kind: "removed" | "added"; text: string };

function contentLines(markdown: string): string[] {
  return stripFrontMatter(markdown)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("Effective from "));
}

export function lineChanges(previous: string, next: string): LineChange[] {
  const before = contentLines(previous);
  const after = contentLines(next);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return [
    ...before.filter((l) => !afterSet.has(l)).map((text) => ({ kind: "removed" as const, text })),
    ...after.filter((l) => !beforeSet.has(l)).map((text) => ({ kind: "added" as const, text })),
  ];
}
