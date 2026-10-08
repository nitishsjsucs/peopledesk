import { Hono } from "hono";
import { APP_VERSION } from "../../shared/domain.ts";
import type { Health } from "../../shared/api-types.ts";
import type { AppEnv } from "../hono-env.ts";

export const healthRoutes = new Hono<AppEnv>().get("/health", async (c) => {
  const cfg = c.get("config");
  const body: Health = {
    ok: true,
    authMode: cfg.authMode,
    llmProvider: cfg.llm.provider,
    model: cfg.llm.model,
    retriever: cfg.retriever,
    asOf: c.get("clock").asOf(),
    version: APP_VERSION,
    datasetSha256: null,
  };
  return c.json(body);
});
