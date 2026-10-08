// requireAuth: identity only from a verified RS256 JWT, mapped to a D1 employee.
// requireSameOrigin: CSRF protection for state-changing browser requests (never treated as proof
// of a human; approval requires identityKind === "user", enforced in ActionService and can()).
// devHostGuard: AUTH_MODE=dev fails closed on any non-local hostname.
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { AppError, errorResponse } from "../errors.ts";
import type { AppEnv } from "../hono-env.ts";
import { IdentityError, verifierFor } from "./identity.ts";
import { resolvePrincipal } from "./principal.ts";

export const ACCESS_HEADER = "Cf-Access-Jwt-Assertion";
export const ACCESS_COOKIE = "CF_Authorization";
export const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalHostname(url: string): boolean {
  return LOCAL_HOSTNAMES.has(new URL(url).hostname);
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const cfg = c.get("config");
  const header = c.req.header(ACCESS_HEADER)?.trim();
  // The Access edge provides the header; the CF_Authorization cookie is only honored in dev mode
  // (set by /dev/token, mirroring what Access gives browsers).
  const token = header || (cfg.authMode === "dev" ? getCookie(c, ACCESS_COOKIE) : undefined);
  if (!token) return errorResponse(401, "unauthenticated", "Authentication required.", c.get("requestId"));
  let identity;
  try {
    identity = await verifierFor(cfg.auth).verify(token);
  } catch (err) {
    const reason = err instanceof IdentityError ? err.reason : "verify_failed";
    console.warn(JSON.stringify({ msg: "auth_rejected", reason, requestId: c.get("requestId") }));
    return errorResponse(401, "unauthenticated", "Authentication required.", c.get("requestId"));
  }
  try {
    c.set("principal", await resolvePrincipal(c.env.DB, identity, { allowServiceTokens: cfg.allowServiceTokens }));
  } catch (err) {
    if (err instanceof AppError) return errorResponse(err.status, err.code, err.message, c.get("requestId"));
    throw err;
  }
  await next();
};

const JSON_CONTENT_TYPE = /^application\/json(\s*;.*)?$/i;

export const requireSameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return next();
  const origin = c.req.header("Origin");
  const fetchSite = c.req.header("Sec-Fetch-Site");
  const requestOrigin = new URL(c.req.url).origin;
  const sameOrigin = origin ? origin === requestOrigin : fetchSite === "same-origin";
  if (!sameOrigin) {
    return errorResponse(403, "forbidden", "Cross-origin request rejected.", c.get("requestId"));
  }
  if (!JSON_CONTENT_TYPE.test(c.req.header("Content-Type") ?? "")) {
    return errorResponse(400, "validation_error", "Content-Type must be application/json.", c.get("requestId"));
  }
  await next();
};
