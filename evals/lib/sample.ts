// A deterministic stratified sample of eval cases, for production runs that must stay inside the
// Workers Free plan's shared daily Workers AI allowance (README, Workers Free plan).
import type { EvalCase } from "../../src/shared/synth/eval-cases.ts";

/**
 * Picks n cases: every category gets a share proportional to its size (largest remainder), at least
 * one each when n allows, and within a category the picks are evenly spaced in dataset order. The same
 * dataset and n always give the same cases, in dataset order.
 */
export function stratifiedSample(cases: readonly EvalCase[], n: number): EvalCase[] {
  if (n >= cases.length) return [...cases];
  if (n <= 0) return [];
  const groups = new Map<string, EvalCase[]>();
  for (const c of cases) {
    const g = groups.get(c.category) ?? [];
    g.push(c);
    groups.set(c.category, g);
  }
  const cats = [...groups.keys()];
  const floorShare = new Map<string, number>();
  const rest: Array<{ cat: string; frac: number }> = [];
  let used = 0;
  for (const cat of cats) {
    const exact = (n * (groups.get(cat) as EvalCase[]).length) / cases.length;
    const f = Math.floor(exact);
    floorShare.set(cat, f);
    used += f;
    rest.push({ cat, frac: exact - f });
  }
  rest.sort((a, b) => b.frac - a.frac || cats.indexOf(a.cat) - cats.indexOf(b.cat));
  for (let i = 0; used < n; i++, used++) {
    const r = rest[i % rest.length] as { cat: string };
    floorShare.set(r.cat, (floorShare.get(r.cat) as number) + 1);
  }
  // At least one per category when n covers every category: take from the largest shares.
  if (n >= cats.length) {
    for (const cat of cats) {
      if ((floorShare.get(cat) as number) > 0) continue;
      const donor = [...floorShare.entries()].sort((a, b) => b[1] - a[1])[0] as [string, number];
      floorShare.set(donor[0], donor[1] - 1);
      floorShare.set(cat, 1);
    }
  }
  const picked = new Set<string>();
  for (const cat of cats) {
    const g = groups.get(cat) as EvalCase[];
    const k = Math.min(g.length, floorShare.get(cat) as number);
    for (let i = 0; i < k; i++) picked.add((g[Math.floor(((i + 0.5) * g.length) / k)] as EvalCase).id);
  }
  return cases.filter((c) => picked.has(c.id));
}
