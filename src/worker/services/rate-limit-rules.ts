// CHAT_RATE_LIMITS rules: parsing and wording, with no Workers types, so the config parser (which the
// Node tests load) can use them. The limiter itself is in rate-limit.ts.
import { z } from "zod";

export type RateLimitScope = "user" | "all";
export type RateLimitRule = { scope: RateLimitScope; max: number; windowSeconds: number };
export type RateLimitBucket = "turn" | "conversation";

export type RateLimitDecision =
  | { ok: true }
  | { ok: false; scope: RateLimitScope; max: number; windowSeconds: number; retryAfterSeconds: number };

/** The subject of account-wide rules. Employee ids are E0001-style, so it cannot collide. */
export const ALL_USERS = "*";

const RULE_RE = /^(user|all):(\d{1,7})\/(\d{1,6})$/;
const MAX_RULES = 6;
const MAX_WINDOW_SECONDS = 7 * 86_400;

const ruleSchema = z.object({
  scope: z.enum(["user", "all"]),
  max: z.number().int().min(1).max(1_000_000),
  windowSeconds: z.number().int().min(1).max(MAX_WINDOW_SECONDS),
});

/**
 * Parses CHAT_RATE_LIMITS: comma-separated `scope:max/seconds` rules, for example
 * `user:6/60,user:60/86400,all:120/86400`. At least one per-user rule is required.
 */
export function parseRateLimits(raw: string | undefined): { ok: true; rules: RateLimitRule[] } | { ok: false; issue: string } {
  const parts = (raw ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return { ok: false, issue: "at least one rule is required (scope:max/seconds)" };
  if (parts.length > MAX_RULES) return { ok: false, issue: `at most ${MAX_RULES} rules` };
  const rules: RateLimitRule[] = [];
  for (const part of parts) {
    const m = RULE_RE.exec(part);
    if (!m) return { ok: false, issue: `"${part}" is not scope:max/seconds with scope user or all` };
    const parsed = ruleSchema.safeParse({ scope: m[1], max: Number(m[2]), windowSeconds: Number(m[3]) });
    if (!parsed.success) return { ok: false, issue: `"${part}": ${parsed.error.issues[0]?.message ?? "invalid"}` };
    if (rules.some((r) => r.scope === parsed.data.scope && r.windowSeconds === parsed.data.windowSeconds)) {
      return { ok: false, issue: `"${part}" repeats a scope and window` };
    }
    rules.push(parsed.data);
  }
  if (!rules.some((r) => r.scope === "user")) return { ok: false, issue: "at least one per-user rule is required" };
  return { ok: true, rules };
}

/** "about 3 minutes", "about 2 hours", for the 429 message. */
export function humanWait(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  if (seconds < 90 * 60) return `about ${Math.round(seconds / 60)} minutes`;
  return `about ${Math.round(seconds / 3600)} hours`;
}
