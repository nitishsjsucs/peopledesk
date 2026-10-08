// Stable stringify: object keys sorted by code unit (no localeCompare), arrays in order, no
// whitespace. Used for the pending-action arguments digest (an integrity check that detects
// serialization drift or a partial write between propose and approve; it is not a security control,
// because anyone who can rewrite the row can rewrite the digest too) and for dataset hashing.

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortDeep(v);
    }
    return out;
  }
  return value;
}
