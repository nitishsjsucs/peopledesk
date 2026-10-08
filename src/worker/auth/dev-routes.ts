// Dev-only routes, registered only when AUTH_MODE=dev (and dev mode itself refuses non-local
// hostnames). They stand in for the Access edge locally: a persona picker and a token issuer that
// signs Access-shaped RS256 JWTs with DEV_ACCESS_PRIVATE_JWK. The private dev key never exists in
// production: production vars do not declare DEV_*.
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { importJWK, SignJWT } from "jose";
import { z } from "zod";
import type { PersonaKey, Role } from "../../shared/domain.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { generateOrg } from "../../shared/synth/org.ts";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../hono-env.ts";
import { ACCESS_COOKIE, requireSameOrigin } from "./middleware.ts";

type PersonaView = { key: PersonaKey; employeeId: string; email: string; fullName: string; role: Role; description: string };

const TOKEN_TTL_SECONDS = 3600;
const personaCache = new Map<string, PersonaView[]>();
const keyCache = new Map<string, CryptoKey>();

/** Personas are structural (identical ids for every business date), so the generator is the source. */
function personasFor(asOf: string): PersonaView[] {
  let p = personaCache.get(asOf);
  if (!p) {
    p = generateOrg(asOf).personas.map((x) => ({ ...x }));
    personaCache.set(asOf, p);
  }
  return p;
}

async function signingKey(privateJwk: string): Promise<{ key: CryptoKey; kid: string }> {
  const jwk = JSON.parse(privateJwk) as { kid?: string };
  if (!jwk.kid) throw new AppError(500, "misconfigured", "DEV_ACCESS_PRIVATE_JWK has no kid (run npm run dev:keys).");
  let key = keyCache.get(privateJwk);
  if (!key) {
    key = (await importJWK(jwk as Parameters<typeof importJWK>[0], "RS256")) as CryptoKey;
    keyCache.set(privateJwk, key);
  }
  return { key, kid: jwk.kid };
}

function subFor(email: string): string {
  const h = sha256Hex(`peopledesk-dev-sub:${email}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const devRoutes = new Hono<AppEnv>()
  .get("/personas", async (c) => {
    const personas = personasFor(c.get("clock").asOf());
    const ids = personas.map((p) => p.employeeId);
    const { results } = await c.env.DB.prepare(
      `SELECT id FROM employees WHERE id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(...ids)
      .all<{ id: string }>();
    const present = new Set(results.map((r) => r.id));
    return c.json({
      personas: personas
        .filter((p) => present.has(p.employeeId))
        .map((p) => ({ key: p.key, employeeId: p.employeeId, email: p.email, role: p.role, description: p.description })),
    });
  })
  .post("/token", requireSameOrigin, async (c) => {
    const cfg = c.get("config");
    if (cfg.auth.mode !== "dev" || !cfg.auth.privateJwk) {
      throw new AppError(500, "misconfigured", "DEV_ACCESS_PRIVATE_JWK is not set (run npm run dev:keys).");
    }
    const parsed = z.object({ email: z.email() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(400, "validation_error", "Body must be { email }.");
    const email = parsed.data.email.toLowerCase();
    const known = await c.env.DB.prepare(
      `SELECT 1 AS ok FROM employees WHERE email = ?1
       UNION ALL SELECT 1 FROM identity_links WHERE identity = ?1 AND kind = 'email' LIMIT 1`,
    )
      .bind(email)
      .first();
    if (!known) throw new AppError(404, "not_found", "No employee with that email.");
    const { key, kid } = await signingKey(cfg.auth.privateJwk);
    const iat = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      email,
      type: "app",
      identity_nonce: crypto.randomUUID(),
      country: "US",
    })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(cfg.auth.issuer)
      .setAudience([cfg.auth.audience])
      .setSubject(subFor(email))
      .setIssuedAt(iat)
      .setNotBefore(iat)
      .setExpirationTime(iat + TOKEN_TTL_SECONDS)
      .sign(key);
    setCookie(c, ACCESS_COOKIE, token, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAge: TOKEN_TTL_SECONDS,
    });
    return c.json({ token, expiresAt: new Date((iat + TOKEN_TTL_SECONDS) * 1000).toISOString() });
  })
  .get("/login", (c) => c.html(LOGIN_HTML));

const LOGIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PeopleDesk dev login</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; background: #f6f7f9; color: #1d2330; }
  main { max-width: 640px; margin: 48px auto; padding: 0 16px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p.note { color: #5b6475; margin: 0 0 24px; }
  ul { list-style: none; padding: 0; display: grid; gap: 10px; }
  button { width: 100%; text-align: left; padding: 12px 14px; border: 1px solid #d5d9e0; border-radius: 8px;
           background: #fff; cursor: pointer; font: inherit; }
  button:hover, button:focus-visible { border-color: #2f6fde; outline: none; box-shadow: 0 0 0 3px #2f6fde33; }
  .role { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #2f6fde; }
  .desc { color: #5b6475; font-size: 13px; }
</style>
</head>
<body>
<main>
  <h1>PeopleDesk local login</h1>
  <p class="note">Dev mode only. Pick a synthetic persona; the Worker signs an Access-shaped RS256 token with the local dev key.</p>
  <ul id="personas" aria-live="polite"><li>Loading personas...</li></ul>
</main>
<script>
  const list = document.getElementById("personas");
  fetch("/dev/personas").then((r) => r.json()).then(({ personas }) => {
    list.textContent = "";
    for (const p of personas) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      const role = document.createElement("div"); role.className = "role"; role.textContent = p.role + " · " + p.key;
      const name = document.createElement("div"); name.textContent = p.email + " (" + p.employeeId + ")";
      const desc = document.createElement("div"); desc.className = "desc"; desc.textContent = p.description;
      b.append(role, name, desc);
      b.addEventListener("click", async () => {
        const r = await fetch("/dev/token", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: p.email }) });
        if (r.ok) location.href = "/"; else alert("Login failed: " + r.status);
      });
      li.append(b); list.append(li);
    }
  });
</script>
</body>
</html>`;
