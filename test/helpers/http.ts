// Authenticated SELF.fetch helpers with zod response assertions. Non-GET requests carry Origin and a
// JSON Content-Type by default, like the SPA and the eval runner do.
import { env, SELF } from "cloudflare:test";
import { expect } from "vitest";
import type { z } from "zod";
import type { PersonaKey } from "../../src/shared/domain.ts";
import { PERSONA_KEYS } from "../../src/shared/domain.ts";
import { ApiErrorSchema } from "../../src/shared/api-types.ts";
import { persona } from "./fixtures.ts";
import { mintToken } from "./tokens.ts";

export const BASE_URL = env.AUTH_MODE === "access" ? "https://peopledesk.test" : "http://localhost";

const tokenCache = new Map<string, string>();

/** A token for a persona key or an email address. */
export async function tokenFor(who: PersonaKey | string): Promise<string> {
  const email = (PERSONA_KEYS as readonly string[]).includes(who) ? persona(who as PersonaKey).email : who;
  let t = tokenCache.get(email);
  if (!t) {
    t = await mintToken({ email });
    tokenCache.set(email, t);
  }
  return t;
}

export type ApiOptions = {
  as?: PersonaKey | string;
  token?: string;
  method?: string;
  body?: unknown;
  /** Origin header for non-GET requests; null omits it. Defaults to BASE_URL. */
  origin?: string | null;
  contentType?: string | null;
  headers?: Record<string, string>;
};

export async function api(path: string, opts: ApiOptions = {}): Promise<Response> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const headers = new Headers(opts.headers);
  const token = opts.token ?? (opts.as ? await tokenFor(opts.as) : undefined);
  if (token) headers.set("Cf-Access-Jwt-Assertion", token);
  if (method !== "GET") {
    if (opts.origin !== null) headers.set("Origin", opts.origin ?? BASE_URL);
    if (opts.contentType !== null) headers.set("Content-Type", opts.contentType ?? "application/json");
  }
  return SELF.fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(opts.body),
  });
}

export async function expectJson<S extends z.ZodType>(res: Response, schema: S, status = 200): Promise<z.infer<S>> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  return schema.parse(JSON.parse(text)) as z.infer<S>;
}

export async function expectError(res: Response, status: number, code: string): Promise<void> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  const body = ApiErrorSchema.parse(JSON.parse(text));
  expect(body.error.code).toBe(code);
}
