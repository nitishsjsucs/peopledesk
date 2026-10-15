// Fixed-window rate limits on chat turns and new conversations, kept in D1 (rate_limits, migration
// 0005). A rule is either per user ("user") or one budget shared by every user ("all"): on the Workers
// Free plan the account's daily Workers AI allocation is shared, so the account-wide rule turns an
// exhausted allocation into a clear 429 instead of failing model calls.
//
// One D1 batch (one transaction, one round trip) per check: drop expired windows, make sure every
// window row exists, then increment every row only if every rule is still under its maximum. A
// request that any rule rejects increments nothing, so a user hammering their own limit never spends
// the shared budget. Windows are aligned to the Unix epoch, so a 86400 s window resets at 00:00 UTC,
// when the Workers AI, D1 and Durable Objects free allocations reset.
import { ALL_USERS } from "./rate-limit-rules.ts";
import type { RateLimitBucket, RateLimitDecision, RateLimitRule } from "./rate-limit-rules.ts";

export { ALL_USERS, humanWait, parseRateLimits } from "./rate-limit-rules.ts";
export type { RateLimitBucket, RateLimitDecision, RateLimitRule, RateLimitScope } from "./rate-limit-rules.ts";

type Window = { rule: RateLimitRule; subject: string; start: number };

export class RateLimiter {
  private readonly db: D1Database;
  private readonly rules: readonly RateLimitRule[];
  private readonly nowMs: () => number;

  constructor(db: D1Database, rules: readonly RateLimitRule[], nowMs: () => number = () => Date.now()) {
    this.db = db;
    this.rules = rules;
    this.nowMs = nowMs;
  }

  /** Counts one request by `employeeId` in `bucket` if every rule admits it. */
  async take(employeeId: string, bucket: RateLimitBucket): Promise<RateLimitDecision> {
    const now = Math.floor(this.nowMs() / 1000);
    const windows: Window[] = this.rules.map((rule) => ({
      rule,
      subject: rule.scope === "user" ? employeeId : ALL_USERS,
      start: now - (now % rule.windowSeconds),
    }));
    // ?1 bucket, ?2 now, ?3 employee; then (subject, window_seconds, window_start) per window.
    const params: Array<string | number> = [bucket, now, employeeId];
    const keys = windows.map((w) => {
      params.push(w.subject, w.rule.windowSeconds, w.start);
      const i = params.length - 2;
      return { subject: `?${i}`, seconds: `?${i + 1}`, start: `?${i + 2}` };
    });
    const matchAny = keys
      .map((k) => `(subject = ${k.subject} AND window_seconds = ${k.seconds} AND window_start = ${k.start})`)
      .join(" OR ");
    // Uncorrelated scalar subqueries: SQLite evaluates each once, before any row changes.
    const underMax = windows
      .map((w, i) => {
        const k = keys[i] as (typeof keys)[number];
        return `(SELECT count FROM rate_limits WHERE bucket = ?1 AND subject = ${k.subject} AND window_seconds = ${k.seconds} AND window_start = ${k.start}) < ${w.rule.max}`;
      })
      .join(" AND ");
    // D1 wants exactly as many bindings as the statement's highest parameter number.
    const bind = (sql: string, count = params.length) => this.db.prepare(sql).bind(...params.slice(0, count));
    const results = await this.db.batch<{ subject: string; window_seconds: number; window_start: number; count: number }>([
      bind(`DELETE FROM rate_limits WHERE bucket = ?1 AND subject IN (?3, '${ALL_USERS}') AND window_start + window_seconds <= ?2`, 3),
      bind(
        `INSERT INTO rate_limits (subject, bucket, window_seconds, window_start, count) VALUES ${keys
          .map((k) => `(${k.subject}, ?1, ${k.seconds}, ${k.start}, 0)`)
          .join(", ")} ON CONFLICT (subject, bucket, window_seconds, window_start) DO NOTHING`,
      ),
      bind(`UPDATE rate_limits SET count = count + 1 WHERE bucket = ?1 AND (${matchAny}) AND ${underMax}`),
      bind(`SELECT subject, window_seconds, window_start, count FROM rate_limits WHERE bucket = ?1 AND (${matchAny})`),
    ]);
    const updated = results[2]?.meta.changes ?? 0;
    if (updated === windows.length) return { ok: true };

    // Rejected: report the exceeded rule whose window ends last (retrying earlier would fail again).
    const rows = results[3]?.results ?? [];
    let worst: RateLimitDecision | null = null;
    for (const w of windows) {
      const row = rows.find((r) => r.subject === w.subject && r.window_seconds === w.rule.windowSeconds && r.window_start === w.start);
      if (!row || row.count < w.rule.max) continue;
      const retryAfterSeconds = Math.max(1, w.start + w.rule.windowSeconds - now);
      if (!worst || worst.ok || retryAfterSeconds > worst.retryAfterSeconds) {
        worst = { ok: false, scope: w.rule.scope, max: w.rule.max, windowSeconds: w.rule.windowSeconds, retryAfterSeconds };
      }
    }
    // A rejection always has a full window; the fallback covers a row deleted by a concurrent writer.
    return worst ?? { ok: false, scope: "user", max: 0, windowSeconds: 60, retryAfterSeconds: 60 };
  }
}
