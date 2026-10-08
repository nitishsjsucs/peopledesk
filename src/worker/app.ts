import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { devRoutes } from "./auth/dev-routes.ts";
import { isLocalHostname, requireAuth, requireSameOrigin } from "./auth/middleware.ts";
import { clockFor } from "./clock.ts";
import { buildServices } from "./container.ts";
import { getConfig } from "./env.ts";
import { mcpRoutes } from "./mcp/route.ts";
import { AppError, errorResponse } from "./errors.ts";
import type { AppEnv } from "./hono-env.ts";
import { healthRoutes } from "./routes/health.ts";
import { meRoutes } from "./routes/me.ts";
import { onboardingRoutes } from "./routes/onboarding.ts";
import { orientationRoutes } from "./routes/orientation.ts";
import { policyRoutes } from "./routes/policies.ts";
import { teamRoutes } from "./routes/team.ts";
import { ticketRoutes } from "./routes/tickets.ts";

export function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    c.header("x-request-id", c.get("requestId"));
    c.header("cache-control", "no-store");
    await next();
  });

  // Config first: invalid config is a 500 on every route. No header, cookie or query parameter can
  // change the auth mode, provider or retriever: they come only from CONFIG_KEYS.
  app.use("*", async (c, next) => {
    const result = getConfig(c.env as unknown as Record<string, unknown>);
    if (!result.ok) {
      console.error(JSON.stringify({ msg: "misconfigured", issues: result.issues }));
      return errorResponse(500, "misconfigured", "Server configuration is invalid.", c.get("requestId"));
    }
    const cfg = result.config;
    // Dev mode fails closed on any non-local hostname, so an accidental production deploy in dev
    // mode cannot accept dev-issued tokens.
    if (cfg.authMode === "dev" && !isLocalHostname(c.req.url)) {
      return errorResponse(500, "misconfigured_auth_mode", "AUTH_MODE=dev is only allowed on localhost.", c.get("requestId"));
    }
    c.set("config", cfg);
    c.set("clock", clockFor(cfg.asOfOverride));
    await next();
  });

  // /dev/* exists only in dev mode.
  app.use("/dev/*", async (c, next) => {
    if (c.get("config").authMode !== "dev") return errorResponse(404, "not_found", "Not found.", c.get("requestId"));
    await next();
  });
  app.route("/dev", devRoutes);

  const withServices: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set("services", buildServices(c.env, c.get("config"), c.get("clock")));
    await next();
  };

  app.use("/mcp", requireAuth);
  app.use("/mcp", withServices);
  app.route("/", mcpRoutes);

  app.use("/api/*", requireAuth);
  app.use("/api/*", requireSameOrigin);
  app.use("/api/*", withServices);
  app.route("/api", healthRoutes);
  app.route("/api", meRoutes);
  app.route("/api", policyRoutes);
  app.route("/api", ticketRoutes);
  app.route("/api", onboardingRoutes);
  app.route("/api", orientationRoutes);
  app.route("/api", teamRoutes);

  app.notFound((c) => errorResponse(404, "not_found", "Not found.", c.get("requestId") ?? "none"));

  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? "none";
    if (err instanceof AppError) return errorResponse(err.status, err.code, err.message, requestId, err.details);
    console.error(JSON.stringify({ msg: "unhandled", requestId, error: String(err), stack: (err as Error).stack }));
    return errorResponse(500, "internal", "Internal error.", requestId);
  });

  return app;
}
