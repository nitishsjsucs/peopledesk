import { env, runInDurableObject } from "cloudflare:test";
import { getAgentByName } from "agents";
import { describe, expect, it } from "vitest";
import type { ConversationAgent } from "../../src/worker/chat/agent.ts";
import { TurnInProgressError, TurnLock, TurnTimeoutError } from "../../src/worker/chat/turn-lock.ts";
import { newConversation } from "../helpers/chat.ts";
import { persona } from "../helpers/fixtures.ts";
import { api, expectError } from "../helpers/http.ts";

describe("TurnLock", () => {
  it("refuses a second turn, times out the first at the ceiling and frees itself", async () => {
    const lock = new TurnLock({ maxTurnMs: 50 });
    let seenSignal: AbortSignal | undefined;
    const latch = new Promise<never>(() => undefined); // never resolves
    const first = lock.run((signal) => {
      seenSignal = signal;
      return latch;
    });
    await expect(lock.run(async () => "second")).rejects.toBeInstanceOf(TurnInProgressError);
    await expect(first).rejects.toBeInstanceOf(TurnTimeoutError);
    expect(seenSignal?.aborted).toBe(true);
    expect(lock.isHeld).toBe(false);
    await expect(lock.run(async () => "after")).resolves.toBe("after");
  });

  it("frees the lock when the turn throws (a failing provider)", async () => {
    const lock = new TurnLock({ maxTurnMs: 1000 });
    await expect(
      lock.run(async () => {
        throw new Error("provider exploded");
      }),
    ).rejects.toThrow("provider exploded");
    expect(lock.isHeld).toBe(false);
  });

  it("makes an RPC sendMessage fail with 409 turn_in_progress while a turn holds the lock", async () => {
    const p = persona("tenured_employee");
    const id = await newConversation(p.key);
    const stub = await getAgentByName(env.CONVERSATION_AGENT, `${p.employeeId}:${id}`);
    const release = await runInDurableObject(stub, (agent: ConversationAgent) => agent.turnLock.acquire().release);
    try {
      await expectError(
        await api(`/api/conversations/${id}/messages`, { as: p.key, body: { text: "How fast does paid time off accrue?" } }),
        409,
        "turn_in_progress",
      );
    } finally {
      await runInDurableObject(stub, () => release());
    }
    const ok = await api(`/api/conversations/${id}/messages`, { as: p.key, body: { text: "How fast does paid time off accrue?" } });
    expect(ok.status).toBe(200);
  });
});
