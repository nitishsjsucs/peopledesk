// Wilson score interval and percentiles. Pure functions, tested against known values.

export type Interval = { rate: number; low: number; high: number };

/** Wilson score interval for a binomial proportion (95% by default). */
export function wilson(passed: number, total: number, z = 1.959964): Interval {
  if (total === 0) return { rate: 0, low: 0, high: 0 };
  const p = passed / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  // At p = 0 and p = 1 the bounds are exactly 0 and 1; avoid floating-point residue there.
  return {
    rate: p,
    low: passed === 0 ? 0 : Math.max(0, center - margin),
    high: passed === total ? 1 : Math.min(1, center + margin),
  };
}

/** Linear-interpolated percentile (the same definition as numpy's default), p in [0, 100]. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (rank - lo);
}

export type Distribution = { p50: number; p95: number; max: number; n: number };

export function distribution(values: readonly number[]): Distribution {
  return {
    p50: Math.round(percentile(values, 50)),
    p95: Math.round(percentile(values, 95)),
    max: values.length ? Math.max(...values) : 0,
    n: values.length,
  };
}
