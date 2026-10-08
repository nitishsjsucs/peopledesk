// Display formatting. UTC only, so a date shown in the UI is the same date stored in D1.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-01-01" -> "Jan 1, 2026". Returns the input unchanged if it is not a date. */
export function formatDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : isoDate;
}

/** "2026-10-15T16:00:00.000Z" -> "Oct 15, 2026 16:00 UTC". */
export function formatDateTime(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${formatDate(m[1] ?? "")} ${m[2]}:${m[3]} UTC`;
}

/** Seconds until an ISO timestamp, rendered as "14 min" / "45 s" / "expired". */
export function formatRelativeExpiry(expiresAtIso: string, nowMs: number): string {
  const ms = Date.parse(expiresAtIso) - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** 1500 -> "$1,500"; 12.5 -> "$12.50". */
export function formatMoney(value: number): string {
  const fixed = Number.isInteger(value) ? String(value) : value.toFixed(2);
  const [whole = "0", frac] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${grouped}${frac ? `.${frac}` : ""}`;
}
