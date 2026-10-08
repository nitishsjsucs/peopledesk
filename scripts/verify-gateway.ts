// npm run verify:gateway
// Production check of AI Gateway logging (needs `npx wrangler login`; the REST reader also needs
// CLOUDFLARE_ACCOUNT_ID and a CLOUDFLARE_API_TOKEN with AI Gateway Read). Makes one Workers AI call with
// gateway metadata turnId = verify-<uuid>, then polls both readers (REST list with search, and the
// binding's getLog) for up to 5 minutes, and prints which reader returned the log and whether cost,
// tokens_in and tokens_out are numeric. Decides whether "tracking cost through AI Gateway" can be claimed.
import { getPlatformProxy } from "wrangler";
import { restReader } from "../evals/lib/gateway.ts";
import { productionEnv, remoteProxyConfig } from "./lib/cloudflare.ts";

type AiLike = {
  run(model: string, inputs: unknown, options: unknown): Promise<unknown>;
  aiGatewayLogId: string | null;
  gateway(id: string): { getLog(id: string): Promise<{ cost?: number; tokens_in?: number; tokens_out?: number; metadata?: Record<string, unknown> }> };
};

const prod = productionEnv();
const gatewayId = prod.vars["AI_GATEWAY_ID"] ?? "peopledesk";
const model = prod.vars["WORKERS_AI_MODEL"] ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const turnId = `verify-${crypto.randomUUID()}`;

const { env, dispose } = await getPlatformProxy<{ AI: AiLike }>({ configPath: remoteProxyConfig(), persist: false });
try {
  await env.AI.run(
    model,
    { messages: [{ role: "user", content: "Reply with the word ok." }], max_tokens: 5 },
    {
      gateway: {
        id: gatewayId,
        collectLog: true,
        skipCache: true,
        metadata: { turnId, purpose: "verify", conversationId: "verify", evalRunId: "none", caseId: "none" },
      },
    },
  );
  const hint = env.AI.aiGatewayLogId;
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  const apiToken = process.env["CLOUDFLARE_API_TOKEN"];
  const rest = accountId && apiToken ? restReader({ accountId, gatewayId, apiToken, fetch }) : null;
  const deadline = Date.now() + 5 * 60_000;
  const report: Record<string, unknown> = { turnId, logIdHint: hint, rest: "not configured", binding: "not found" };
  for (;;) {
    if (rest && report["rest"] !== "found") {
      try {
        const logs = await rest(turnId);
        if (logs.length > 0) report["rest"] = "found", (report["restLog"] = logs[0]);
      } catch (err) {
        report["rest"] = `error: ${String(err)}`;
      }
    }
    if (hint && report["binding"] !== "found") {
      try {
        const log = await env.AI.gateway(gatewayId).getLog(hint);
        if (log.metadata?.["turnId"] === turnId) {
          report["binding"] = "found";
          report["bindingLog"] = { cost: log.cost, tokens_in: log.tokens_in, tokens_out: log.tokens_out };
        }
      } catch {
        // not yet visible
      }
    }
    if ((report["rest"] === "found" || !rest) && report["binding"] === "found") break;
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 15_000));
  }
  const log = (report["bindingLog"] ?? report["restLog"]) as { cost?: unknown; tokens_in?: unknown; tokens_out?: unknown; tokensIn?: unknown; tokensOut?: unknown } | undefined;
  report["costNumeric"] = typeof log?.cost === "number";
  report["tokensNumeric"] = typeof (log?.tokens_in ?? log?.tokensIn) === "number" && typeof (log?.tokens_out ?? log?.tokensOut) === "number";
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report["binding"] === "found" || report["rest"] === "found" ? 0 : 1;
} finally {
  await dispose();
}
