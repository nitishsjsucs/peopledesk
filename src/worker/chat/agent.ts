// ConversationAgent: one Durable Object per (employee, conversation). It holds the transcript and turn
// traces in its own SQLite, enforces one turn at a time, and runs the orchestrator with services built
// from its own env. No Agent state (no initialState/setState): SQLite holds everything. The Worker
// reaches it over RPC only, with a Principal it has already verified.
import { Agent } from "agents";
import type { TranscriptMessage, TurnResult, TurnTrace } from "../../shared/api-types.ts";
import type { Principal } from "../auth/principal.ts";
import { FixedClock } from "../clock.ts";
import { buildServices, providerFor } from "../container.ts";
import { getConfig } from "../env.ts";
import type { LlmProvider } from "../llm/provider.ts";
import { approvalOriginFor } from "../mcp/route.ts";
import { runTurn } from "./orchestrator.ts";
import { ERROR_TEXT } from "./render.ts";
import { TurnInProgressError, TurnLock, TurnTimeoutError } from "./turn-lock.ts";

export const MAX_TURN_MS = 60_000;

export type SendMessageInput = {
  principal: Principal;
  text: string;
  asOf: string;
  evalRunId?: string;
  caseId?: string;
  requestOrigin: string;
};

/**
 * A busy conversation is an expected outcome, not an exception: throwing across RPC would be logged as
 * an uncaught error in the Durable Object on every 409.
 */
export type SendMessageOutcome = { ok: true; result: TurnResult } | { ok: false; code: "turn_in_progress" };

type MessageRow = {
  id: number;
  turn_id: string;
  role: "user" | "assistant" | "system";
  kind: string;
  text: string;
  payload_json: string | null;
  created_at: string;
};

export class ConversationAgent extends Agent<Env> {
  // Class-field initializers run before the Agent's name is available: nothing here uses this.name.
  private ids!: { employeeId: string; conversationId: string };
  readonly turnLock = new TurnLock({ maxTurnMs: MAX_TURN_MS });
  /** Test-only seam set through runInDurableObject; never reachable from a request. */
  providerOverride: LlmProvider | undefined;

  override onStart(): void {
    const [employeeId, conversationId, ...rest] = this.name.split(":");
    if (!employeeId || !conversationId || rest.length > 0) throw new Error(`bad agent name ${this.name}`);
    this.ids = { employeeId, conversationId };
    this.sql`CREATE TABLE IF NOT EXISTS pd_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turn_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL)`;
    this.sql`CREATE TABLE IF NOT EXISTS pd_turns (turn_id TEXT PRIMARY KEY, trace_json TEXT NOT NULL, created_at TEXT NOT NULL)`;
  }

  /** Defense in depth: the Worker already checked ownership in D1. */
  private assertOwner(principal: Principal): void {
    if (principal.employeeId !== this.ids.employeeId) throw new Error("forbidden: conversation owner mismatch");
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageOutcome> {
    this.assertOwner(input.principal);
    const cfg = getConfig(this.env as unknown as Record<string, unknown>);
    if (!cfg.ok) throw new Error("misconfigured");
    // The business date comes from the Worker's clock; timestamps stay wall time.
    const clock = new FixedClock(input.asOf);
    const services = buildServices(this.env, cfg.config, clock);
    const provider = this.providerOverride ?? providerFor(cfg.config, this.env);
    const turnId = crypto.randomUUID();
    const conversationId = this.ids.conversationId;
    if (this.turnLock.isHeld) return { ok: false, code: "turn_in_progress" };
    let result: TurnResult;
    try {
      result = await this.turnLock.run((signal) =>
        runTurn(
          {
            provider,
            services,
            principal: input.principal,
            conversationId,
            turnId,
            asOf: input.asOf,
            approvalOrigin: approvalOriginFor(cfg.config, input.requestOrigin),
            history: this.history(),
            ...(input.evalRunId ? { evalRunId: input.evalRunId } : {}),
            ...(input.caseId ? { caseId: input.caseId } : {}),
            signal,
          },
          input.text,
        ),
      );
    } catch (err) {
      if (err instanceof TurnInProgressError) return { ok: false, code: "turn_in_progress" };
      const code = err instanceof TurnTimeoutError ? "turn_timeout" : "internal";
      if (code === "internal") console.error(JSON.stringify({ msg: "turn_failed", turnId, error: String(err) }));
      result = {
        turnId,
        conversationId,
        kind: "error",
        text: ERROR_TEXT[code],
        citations: [],
        error: { code, message: ERROR_TEXT[code] },
        trace: {
          asOf: input.asOf,
          llmProvider: provider.id,
          model: provider.model,
          totalMs: 0,
          router: { intent: "none", ms: 0, inputTokens: 0, outputTokens: 0, retries: 0 },
          gatewayLogIdHints: [],
        },
      };
    }
    this.persist(turnId, input.text, result);
    return { ok: true, result };
  }

  private persist(turnId: string, userText: string, result: TurnResult): void {
    const now = new Date().toISOString();
    this.sql`INSERT INTO pd_messages (turn_id, role, kind, text, payload_json, created_at)
             VALUES (${turnId}, 'user', 'user', ${userText.trim()}, NULL, ${now})`;
    this.sql`INSERT INTO pd_messages (turn_id, role, kind, text, payload_json, created_at)
             VALUES (${turnId}, 'assistant', ${result.kind}, ${result.text}, ${JSON.stringify(result)}, ${now})`;
    this.sql`INSERT INTO pd_turns (turn_id, trace_json, created_at) VALUES (${turnId}, ${JSON.stringify(result.trace)}, ${now})`;
  }

  /** The previous user messages, and earlier assistant replies reduced to their kind and tool name. */
  private history(): { userMessages: string[]; assistantTurns: Array<{ kind: string; tool?: string }> } {
    const rows = this.sql<MessageRow>`SELECT * FROM pd_messages WHERE role != 'system' ORDER BY id DESC LIMIT 8`.reverse();
    const userMessages = rows.filter((r) => r.role === "user").map((r) => r.text);
    const assistantTurns = rows
      .filter((r) => r.role === "assistant")
      .map((r) => {
        const tool = (JSON.parse(r.payload_json ?? "{}") as { toolCall?: { tool?: string } }).toolCall?.tool;
        return tool ? { kind: r.kind, tool } : { kind: r.kind };
      });
    return { userMessages, assistantTurns };
  }

  async getTranscript(input: { principal: Principal }): Promise<TranscriptMessage[]> {
    this.assertOwner(input.principal);
    return this.sql<MessageRow>`SELECT * FROM pd_messages ORDER BY id`.map((r) => ({
      id: r.id,
      turnId: r.turn_id,
      role: r.role,
      kind: r.kind,
      text: r.text,
      ...(r.payload_json ? { payload: JSON.parse(r.payload_json) as unknown } : {}),
      createdAt: r.created_at,
    }));
  }

  async getTurnTrace(input: { principal: Principal; turnId: string }): Promise<TurnTrace | null> {
    this.assertOwner(input.principal);
    const [row] = this.sql<{ trace_json: string }>`SELECT trace_json FROM pd_turns WHERE turn_id = ${input.turnId}`;
    return row ? (JSON.parse(row.trace_json) as TurnTrace) : null;
  }

  async recordActionOutcome(input: {
    principal: Principal;
    actionId: string;
    outcome: { status: "executed" | "rejected" | "failed"; summary: string };
  }): Promise<void> {
    this.assertOwner(input.principal);
    const now = new Date().toISOString();
    const payload = JSON.stringify({ actionId: input.actionId, status: input.outcome.status });
    this.sql`INSERT INTO pd_messages (turn_id, role, kind, text, payload_json, created_at)
             VALUES (${`action:${input.actionId}`}, 'system', 'action_outcome', ${input.outcome.summary}, ${payload}, ${now})`;
  }
}
