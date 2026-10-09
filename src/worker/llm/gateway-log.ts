// Binding reader for AI Gateway logs (production only): env.AI.gateway(id).getLog(logIdHint). The hint
// is env.AI.aiGatewayLogId captured after each call, which concurrent calls in one isolate can
// overwrite, so a log whose metadata.turnId does not match the turn is reported as missing.
export type GatewayLogView = {
  logId: string;
  purpose: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs: number;
  cost?: number;
  cached: boolean;
};

export type GatewayLike = { getLog(logId: string): Promise<AiGatewayLog> };

export type GatewayLogLookup = { found: GatewayLogView[]; missing: Array<{ logId: string; reason: string }> };

export class BindingGatewayLogReader {
  private readonly gateway: GatewayLike;
  constructor(gateway: GatewayLike) {
    this.gateway = gateway;
  }

  async readTurn(turnId: string, hints: ReadonlyArray<{ logId: string; purpose: string }>): Promise<GatewayLogLookup> {
    const out: GatewayLogLookup = { found: [], missing: [] };
    for (const hint of hints) {
      let log: AiGatewayLog;
      try {
        log = await this.gateway.getLog(hint.logId);
      } catch (err) {
        // The binding's exception text can describe the account, the gateway or an internal error: it
        // goes to the Worker logs only, and the caller gets a fixed reason.
        console.warn(JSON.stringify({ msg: "gateway_getlog_failed", turnId, logId: hint.logId, error: String(err) }));
        out.missing.push({ logId: hint.logId, reason: "unavailable" });
        continue;
      }
      if (log.metadata?.["turnId"] !== turnId) {
        out.missing.push({ logId: hint.logId, reason: "metadata.turnId does not match (the hint raced)" });
        continue;
      }
      out.found.push({
        logId: log.id,
        purpose: String(log.metadata?.["purpose"] ?? hint.purpose),
        model: log.model,
        ...(typeof log.tokens_in === "number" ? { tokensIn: log.tokens_in } : {}),
        ...(typeof log.tokens_out === "number" ? { tokensOut: log.tokens_out } : {}),
        durationMs: log.duration,
        ...(typeof log.cost === "number" ? { cost: log.cost } : {}),
        cached: log.cached,
      });
    }
    return out;
  }
}
