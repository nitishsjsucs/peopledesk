// Builds the Worker's per-request services and a principal directly, for tests that exercise modules
// below the HTTP layer (in-process MCP client, ActionService, orchestrator).
import { env } from "cloudflare:test";
import type { PersonaKey } from "../../src/shared/domain.ts";
import { resolvePrincipal } from "../../src/worker/auth/principal.ts";
import type { Principal } from "../../src/worker/auth/principal.ts";
import { clockFor } from "../../src/worker/clock.ts";
import { buildServices } from "../../src/worker/container.ts";
import type { Services } from "../../src/worker/container.ts";
import { getConfig } from "../../src/worker/env.ts";
import { persona } from "./fixtures.ts";

export function testServices(overrides: Partial<Env> = {}): Services {
  const e = { ...env, ...overrides } as Env;
  const cfg = getConfig(e as unknown as Record<string, unknown>);
  if (!cfg.ok) throw new Error(`test config invalid: ${cfg.issues.join("; ")}`);
  return buildServices(e, cfg.config, clockFor(cfg.config.asOfOverride));
}

export async function principalFor(who: PersonaKey | string, kind: "user" | "service_token" = "user"): Promise<Principal> {
  const email = who.includes("@") ? who : persona(who as PersonaKey).email;
  const p = await resolvePrincipal(env.DB, { kind: "user", email, sub: "test", claims: {} }, { allowServiceTokens: true });
  return { ...p, identityKind: kind };
}
