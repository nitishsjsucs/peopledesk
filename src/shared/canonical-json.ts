// Stable stringify: the same bytes for the same JSON value, whatever the key insertion order. Object
// keys are sorted by code unit (no localeCompare); integer-like keys still come first in ascending
// numeric order, because ECMAScript orders them that way in every object, which is deterministic too.
// Arrays keep their order, there is no whitespace, undefined members are dropped and toJSON is honored,
// exactly as JSON.stringify would do. Used for the pending-action arguments digest (an integrity check
// that detects serialization drift or a partial write between propose and approve; it is not a
// security control, because anyone who can rewrite the row can rewrite the digest too) and for
// dataset hashing.

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (value !== null && typeof value === "object" && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return sortDeep((value as { toJSON: () => unknown }).toJSON());
  }
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
