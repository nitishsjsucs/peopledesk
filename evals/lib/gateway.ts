// Production: AI Gateway logs for a run's turns. Two readers, because the Logs API is documented for
// Legacy Logs and a new gateway may not offer it:
//   1. REST list with `search=<turnId>` (free-text search over log metadata), then client-side matching
//      on metadata.turnId and metadata.purpose (token permission: AI Gateway Read);
//   2. the Worker's binding route GET /api/conversations/:id/turns/:turnId/gateway-logs.
// Logs can lag, so the caller retries for up to 5 minutes after the run.
import type { GatewayLogSample, TurnLogs } from "./report.ts";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

type RestLog = { id: string; metadata?: unknown; cost?: number; tokens_in?: number; tokens_out?: number; duration?: number };

function metadataOf(log: RestLog): Record<string, unknown> {
  if (typeof log.metadata === "string") {
    try {
      return JSON.parse(log.metadata) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (log.metadata ?? {}) as Record<string, unknown>;
}

export function restReader(opts: { accountId: string; gatewayId: string; apiToken: string; fetch: FetchFn }) {
  return async (turnId: string): Promise<GatewayLogSample[]> => {
    const u = new URL(`https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/ai-gateway/gateways/${opts.gatewayId}/logs`);
    u.searchParams.set("search", turnId);
    u.searchParams.set("per_page", "50");
    const res = await opts.fetch(u.toString(), { headers: { Authorization: `Bearer ${opts.apiToken}` } });
    if (!res.ok) throw new Error(`AI Gateway logs list answered ${res.status}`);
    const body = (await res.json()) as { result?: RestLog[] };
    return (body.result ?? [])
      .filter((l) => metadataOf(l)["turnId"] === turnId)
      .map((l) => ({
        ...(typeof l.cost === "number" ? { cost: l.cost } : {}),
        ...(typeof l.tokens_in === "number" ? { tokensIn: l.tokens_in } : {}),
        ...(typeof l.tokens_out === "number" ? { tokensOut: l.tokens_out } : {}),
      }));
  };
}

export function bindingRouteReader(opts: { baseUrl: string; fetch: FetchFn; headersFor: (turn: { persona: string }) => Record<string, string> }) {
  return async (turn: { conversationId: string; turnId: string; persona: string }): Promise<GatewayLogSample[]> => {
    const res = await opts.fetch(
      `${new URL(opts.baseUrl).origin}/api/conversations/${turn.conversationId}/turns/${turn.turnId}/gateway-logs`,
      { headers: opts.headersFor(turn) },
    );
    if (!res.ok) throw new Error(`gateway-logs route answered ${res.status}`);
    const body = (await res.json()) as { logs: Array<{ cost?: number; tokensIn?: number; tokensOut?: number }> };
    return body.logs;
  };
}

/**
 * Tries REST first, then the binding route, retrying until every turn has as many logs as it made
 * model calls, or until the deadline. Returns the logs per turn, or null when nothing could be read.
 */
export async function collectGatewayLogs(
  turns: Array<{ conversationId: string; turnId: string; persona: string; llmCalls: number }>,
  readers: {
    rest?: (turnId: string) => Promise<GatewayLogSample[]>;
    binding?: (turn: { conversationId: string; turnId: string; persona: string }) => Promise<GatewayLogSample[]>;
  },
  opts: { deadlineMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<TurnLogs[] | null> {
  const deadline = Date.now() + (opts.deadlineMs ?? 5 * 60_000);
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const found = new Map<string, GatewayLogSample[]>();
  let anyReader = false;
  for (;;) {
    for (const t of turns) {
      if ((found.get(t.turnId)?.length ?? 0) >= t.llmCalls) continue;
      let logs: GatewayLogSample[] | null = null;
      if (readers.rest) {
        try {
          logs = await readers.rest(t.turnId);
          anyReader = true;
        } catch {
          logs = null;
        }
      }
      if ((!logs || logs.length < t.llmCalls) && readers.binding) {
        try {
          const b = await readers.binding(t);
          anyReader = true;
          if (!logs || b.length > logs.length) logs = b;
        } catch {
          // keep whatever REST returned
        }
      }
      if (logs) found.set(t.turnId, logs);
    }
    const complete = turns.every((t) => (found.get(t.turnId)?.length ?? 0) >= t.llmCalls);
    if (complete || Date.now() >= deadline) break;
    await sleep(opts.intervalMs ?? 15_000);
  }
  if (!anyReader) return null;
  return turns.map((t) => ({ turnId: t.turnId, llmCalls: t.llmCalls, logs: found.get(t.turnId) ?? [] }));
}
