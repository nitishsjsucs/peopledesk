// npm run verify:gateway
//
// Production check of AI Gateway. Passes when the gateway exists and a real model call went through
// it; whether its logs can be read back is reported but is not required, because gateways created on
// or after 2026-09-24 keep their logs in Workers Logs (3 days on the Free plan) and AI Gateway's docs
// describe no logs API for them (README, Workers Free plan).
//   1. The gateway named by AI_GATEWAY_ID exists and collects logs (REST API, CF_API_TOKEN with AI
//      Gateway Read or Edit).
//   2. A model call through the gateway:
//      - during an eval window (npm run deploy:eval-window), one chat turn on the deployed Worker as the
//        tenured employee persona's service token: the turn's trace must carry a gateway log id for
//        every model call (the Worker reads env.AI.aiGatewayLogId after each call), and the Worker's
//        gateway-logs route then tries to read those logs (about 66 neurons);
//      - otherwise, one five-token Workers AI call from this machine through a remote AI binding
//        (wrangler's OAuth login; about 1 neuron), which must return a gateway log id.
// The model call counts against the production CHAT_RATE_LIMITS (the chat turn) or the shared daily
// neuron allowance (both).
import { getPlatformProxy } from "wrangler";
import { productionEnv, remoteProxyConfig } from "./lib/cloudflare.ts";
import { cfGetOrNull, PROD, readServiceTokens } from "./lib/production.ts";

type AiLike = {
  run(model: string, inputs: unknown, options: unknown): Promise<unknown>;
  aiGatewayLogId: string | null;
  gateway(id: string): { getLog(id: string): Promise<{ cost?: number; tokens_in?: number; tokens_out?: number; metadata?: Record<string, unknown> }> };
};

const report: Record<string, unknown> = { gateway: PROD.gateway };
let ok = true;

const gw = await cfGetOrNull<{ id: string; collect_logs?: boolean }>(`ai-gateway/gateways/${PROD.gateway}`).catch((err: unknown) => {
  report["gatewayError"] = String((err as Error).message);
  return null;
});
report["gatewayExists"] = !!gw;
report["collectLogs"] = gw?.collect_logs ?? null;
if (!gw) ok = false;

const base = `https://${PROD.hostname}`;
const token = readServiceTokens().tenured_employee;
const headers = token ? { "CF-Access-Client-Id": token.clientId, "CF-Access-Client-Secret": token.clientSecret } : null;
const windowOpen = headers ? (await fetch(`${base}/api/health`, { headers, redirect: "manual" }).catch(() => null))?.status === 200 : false;

if (windowOpen && headers) {
  report["path"] = "deployed Worker, one chat turn (eval window)";
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { ...headers, "content-type": "application/json", origin: base }, body: JSON.stringify(body) });
  const conv = (await (await post("/api/conversations", {})).json()) as { id: string };
  const res = await post(`/api/conversations/${conv.id}/messages`, { text: "How many days of paid time off do I accrue each month?" });
  const turn = (await res.json().catch(() => null)) as { turnId?: string; kind?: string; trace?: { gatewayLogIdHints?: string[]; router?: { retries?: number }; composer?: unknown } } | null;
  const hints = turn?.trace?.gatewayLogIdHints ?? [];
  report["turn"] = { status: res.status, kind: turn?.kind ?? null, gatewayLogIds: hints.length };
  if (res.status !== 200 || hints.length === 0) ok = false;
  if (turn?.turnId && hints.length > 0) {
    const deadline = Date.now() + 2 * 60_000;
    type Read = { logs: Array<{ cost?: number; tokensIn?: number; tokensOut?: number }>; missing: unknown[] };
    let logs: Read["logs"] = [];
    while (Date.now() < deadline) {
      const r = await fetch(`${base}/api/conversations/${conv.id}/turns/${turn.turnId}/gateway-logs`, { headers });
      if (r.ok) {
        logs = ((await r.json()) as Read).logs;
        if (logs.length >= hints.length) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
    report["logsReadable"] = logs.length > 0;
    report["costNumeric"] = logs.length > 0 && logs.every((l) => typeof l.cost === "number");
  }
} else {
  report["path"] = "direct remote AI binding (no eval window open)";
  const prod = productionEnv();
  const model = prod.vars["WORKERS_AI_MODEL"] ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const turnId = `verify-${crypto.randomUUID()}`;
  const { env, dispose } = await getPlatformProxy<{ AI: AiLike }>({ configPath: remoteProxyConfig(), persist: false });
  try {
    await env.AI.run(
      model,
      { messages: [{ role: "user", content: "Reply with the word ok." }], max_tokens: 5 },
      { gateway: { id: PROD.gateway, collectLog: true, skipCache: true, metadata: { turnId, purpose: "verify", conversationId: "verify", evalRunId: "none", caseId: "none" } } },
    );
    const hint = env.AI.aiGatewayLogId;
    report["gatewayLogId"] = hint ? "present" : "missing";
    if (!hint) ok = false;
    if (hint) {
      const deadline = Date.now() + 2 * 60_000;
      report["logsReadable"] = false;
      while (Date.now() < deadline) {
        try {
          const log = await env.AI.gateway(PROD.gateway).getLog(hint);
          if (log.metadata?.["turnId"] === turnId) {
            report["logsReadable"] = true;
            report["costNumeric"] = typeof log.cost === "number";
            break;
          }
        } catch {
          // not visible (yet)
        }
        await new Promise((resolve) => setTimeout(resolve, 15_000));
      }
    }
  } finally {
    await dispose();
  }
}

if (report["logsReadable"] === false) {
  report["note"] =
    "Logs were not readable back. For a gateway created on or after 2026-09-24 they are in Workers Logs (dashboard, 3 days on Free); " +
    "the production eval then reports cost as a labeled list-price estimate from token counts, never as AI Gateway's figure.";
}
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 1);
