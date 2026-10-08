import { Hono } from "hono";
import { clockFor } from "./clock.ts";
import { getConfig } from "./env.ts";
import { AppError, errorResponse } from "./errors.ts";
import type { AppEnv } from "./hono-env.ts";
import { healthRoutes } from "./routes/health.ts";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    c.header("x-request-id", c.get("requestId"));
    await next();
  });

  // Config first: invalid config is a 500 on every route.
  app.use("*", async (c, next) => {
    const result = getConfig(c.env as unknown as Record<string, unknown>);
    if (!result.ok) {
      console.error(JSON.stringify({ msg: "misconfigured", issues: result.issues }));
      return errorResponse(500, "misconfigured", "Server configuration is invalid.", c.get("requestId"));
    }
    const cfg = result.config;
    // Dev mode fails closed on any non-local hostname, so an accidental production deploy in dev
    // mode cannot accept dev-issued tokens.
    if (cfg.authMode === "dev" && !LOCAL_HOSTNAMES.has(new URL(c.req.url).hostname)) {
      return errorResponse(
        500,
        "misconfigured_auth_mode",
        "AUTH_MODE=dev is only allowed on localhost.",
        c.get("requestId"),
      );
    }
    c.set("config", cfg);
    c.set("clock", clockFor(cfg.asOfOverride));
    await next();
  });

  app.route("/api", healthRoutes);

  app.notFound((c) => errorResponse(404, "not_found", "Not found.", c.get("requestId") ?? "none"));

  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? "none";
    if (err instanceof AppError) return errorResponse(err.status, err.code, err.message, requestId, err.details);
    console.error(JSON.stringify({ msg: "unhandled", requestId, error: String(err) }));
    return errorResponse(500, "internal", "Internal error.", requestId);
  });

  return app;
}
