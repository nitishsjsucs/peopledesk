// CHAT_RATE_LIMITS: the D1 fixed-window limiter, and the 429 it produces on the chat routes.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ApiErrorSchema } from "../../src/shared/api-types.ts";
import { ALL_USERS, RateLimiter } from "../../src/worker/services/rate-limit.ts";
import type { RateLimitRule } from "../../src/worker/services/rate-limit.ts";
import { newConversation, send } from "../helpers/chat.ts";
import { persona } from "../helpers/fixtures.ts";
import { api } from "../helpers/http.ts";

const T0 = Date.UTC(2026, 9, 15, 12, 0, 30); // 30 s into a minute window
const user = (max: number, windowSeconds: number): RateLimitRule => ({ scope: "user", max, windowSeconds });
const all = (max: number, windowSeconds: number): RateLimitRule => ({ scope: "all", max, windowSeconds });

function limiter(rules: RateLimitRule[], clock: { now: number }) {
  return new RateLimiter(env.DB, rules, () => clock.now);
}

async function counts(subject: string, bucket = "turn"): Promise<Array<{ window_seconds: number; count: number }>> {
  const { results } = await env.DB.prepare(
    "SELECT window_seconds, count FROM rate_limits WHERE subject = ?1 AND bucket = ?2 ORDER BY window_seconds",
  )
    .bind(subject, bucket)
    .all<{ window_seconds: number; count: number }>();
  return results;
}

describe("RateLimiter", () => {
  it("admits max requests per window, then rejects with the seconds left in the window", async () => {
    const clock = { now: T0 };
    const rl = limiter([user(3, 60)], clock);
    for (let i = 0; i < 3; i++) expect(await rl.take("U-A", "turn")).toEqual({ ok: true });
    expect(await rl.take("U-A", "turn")).toEqual({ ok: false, scope: "user", max: 3, windowSeconds: 60, retryAfterSeconds: 30 });
    // A rejected request is not counted.
    expect(await counts("U-A")).toEqual([{ window_seconds: 60, count: 3 }]);
    clock.now = T0 + 30_000; // the next window
    expect(await rl.take("U-A", "turn")).toEqual({ ok: true });
    // The expired window's row was deleted by that check.
    expect(await counts("U-A")).toEqual([{ window_seconds: 60, count: 1 }]);
  });

  it("keeps users, and the turn and conversation buckets, apart", async () => {
    const clock = { now: T0 };
    const rl = limiter([user(1, 60)], clock);
    expect((await rl.take("U-B", "turn")).ok).toBe(true);
    expect((await rl.take("U-B", "turn")).ok).toBe(false);
    expect((await rl.take("U-C", "turn")).ok).toBe(true);
    expect((await rl.take("U-B", "conversation")).ok).toBe(true);
  });

  it("shares an account-wide rule between users", async () => {
    const clock = { now: T0 };
    const rl = limiter([user(10, 60), all(2, 86_400)], clock);
    expect((await rl.take("U-D", "turn")).ok).toBe(true);
    expect((await rl.take("U-E", "turn")).ok).toBe(true);
    const d = await rl.take("U-F", "turn");
    // 12:00:30 UTC: the daily window ends at 00:00 UTC, 43,170 s later.
    expect(d).toEqual({ ok: false, scope: "all", max: 2, windowSeconds: 86_400, retryAfterSeconds: 43_170 });
    expect(await counts(ALL_USERS)).toEqual([{ window_seconds: 86_400, count: 2 }]);
  });

  it("counts a request against no rule when any rule rejects it", async () => {
    const clock = { now: T0 };
    // A window no other test in this file uses, so the shared row starts empty.
    const rl = limiter([user(1, 60), all(100, 7_200)], clock);
    expect((await rl.take("U-G", "turn")).ok).toBe(true);
    for (let i = 0; i < 5; i++) expect((await rl.take("U-G", "turn")).ok).toBe(false);
    // Hammering one's own limit does not spend the shared budget.
    expect((await counts(ALL_USERS)).find((r) => r.window_seconds === 7_200)?.count).toBe(1);
    expect(await counts("U-G")).toEqual([{ window_seconds: 60, count: 1 }]);
  });

  it("reports the exceeded rule whose window ends last", async () => {
    const clock = { now: T0 };
    const rl = limiter([user(1, 60), user(1, 3_600)], clock);
    expect((await rl.take("U-H", "turn")).ok).toBe(true);
    expect(await rl.take("U-H", "turn")).toEqual({ ok: false, scope: "user", max: 1, windowSeconds: 3_600, retryAfterSeconds: 3_570 });
  });

  it("admits exactly max of many concurrent requests", async () => {
    const clock = { now: T0 };
    const rl = limiter([user(5, 60), all(1_000, 86_400)], clock);
    const decisions = await Promise.all(Array.from({ length: 20 }, () => rl.take("U-I", "turn")));
    expect(decisions.filter((d) => d.ok)).toHaveLength(5);
    expect(await counts("U-I")).toEqual([{ window_seconds: 60, count: 5 }]);
  });
});

describe("rate limits on the chat routes", () => {
  // The worker project pins CHAT_RATE_LIMITS to user:1000/60,all:1000000/86400 (test/pool-vars.ts), so
  // these tests fill the current window directly instead of sending a thousand requests.
  async function fill(subject: string, bucket: "turn" | "conversation", windowSeconds: number, count: number) {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO rate_limits (subject, bucket, window_seconds, window_start, count) VALUES (?1, ?2, ?3, ?4, ?5) " +
        "ON CONFLICT (subject, bucket, window_seconds, window_start) DO UPDATE SET count = excluded.count",
    )
      .bind(subject, bucket, windowSeconds, now - (now % windowSeconds), count)
      .run();
  }

  it("answers 429 rate_limited with Retry-After on a turn over the per-user limit, and runs no turn", async () => {
    const who = persona("tenured_employee");
    const id = await newConversation("tenured_employee");
    await fill(who.employeeId, "turn", 60, 1000);
    const res = await api(`/api/conversations/${id}/messages`, { as: "tenured_employee", body: { text: "How much PTO do I get?" } });
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    const body = ApiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.message).toMatch(/^You have sent too many messages\. Try again in /);
    expect(body.error.details).toEqual({ scope: "user", retryAfterSeconds: retryAfter });
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    // Nothing reached the conversation's agent.
    const conv = await api(`/api/conversations/${id}`, { as: "tenured_employee" });
    expect(((await conv.json()) as { messages: unknown[] }).messages).toEqual([]);
  });

  it("answers 429 for everyone once the account-wide budget is spent", async () => {
    const id = await newConversation("manager_with_new_hires");
    await fill(ALL_USERS, "turn", 86_400, 1_000_000);
    const res = await api(`/api/conversations/${id}/messages`, { as: "manager_with_new_hires", body: { text: "Hi" } });
    expect(res.status).toBe(429);
    const body = ApiErrorSchema.parse(await res.json());
    expect(body.error.message).toMatch(/^PeopleDesk has reached its shared chat capacity for now\./);
    expect(body.error.details).toMatchObject({ scope: "all" });
    await fill(ALL_USERS, "turn", 86_400, 0);
    const ok = await send("manager_with_new_hires", id, "How much PTO do I get?");
    expect(ok.turnId).toBeTruthy();
  });

  it("limits new conversations per user", async () => {
    const who = persona("hr_admin");
    await fill(who.employeeId, "conversation", 60, 1000);
    const res = await api("/api/conversations", { as: "hr_admin", body: {} });
    expect(res.status).toBe(429);
    const body = ApiErrorSchema.parse(await res.json());
    expect(body.error.message).toMatch(/^You have started too many conversations\./);
    // Another user is unaffected.
    expect((await api("/api/conversations", { as: "new_hire_booked", body: {} })).status).toBe(201);
  });

  it("checks ownership before counting: another user's conversation is a 404 that spends nothing", async () => {
    const id = await newConversation("new_hire_unbooked");
    const intruder = persona("manager_no_new_hires");
    const res = await api(`/api/conversations/${id}/messages`, { as: "manager_no_new_hires", body: { text: "Hi" } });
    expect(res.status).toBe(404);
    expect(await counts(intruder.employeeId)).toEqual([]);
  });
});
