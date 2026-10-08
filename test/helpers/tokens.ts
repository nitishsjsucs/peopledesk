// Mints Access-shaped RS256 JWTs with the per-run test key (TEST_ACCESS_PRIVATE_JWK), plus the
// malformed variants the auth tests need.
import { env } from "cloudflare:test";
import { base64url, exportJWK, generateKeyPair, importJWK, SignJWT } from "jose";
import type { JWK } from "jose";

export type MintOptions = {
  email?: string;
  commonName?: string;
  sub?: string;
  iss?: string;
  aud?: string | string[];
  iat?: number;
  nbf?: number;
  exp?: number;
  kid?: string;
  /** A different private JWK (JSON string); defaults to the test key. */
  privateJwk?: string;
  claims?: Record<string, unknown>;
};

export const testIssuer = (): string =>
  env.AUTH_MODE === "access" ? (env.ACCESS_TEAM_DOMAIN ?? "") : (env.DEV_ACCESS_ISSUER ?? "");
export const testAudience = (): string => (env.AUTH_MODE === "access" ? (env.ACCESS_AUD ?? "") : (env.DEV_ACCESS_AUD ?? ""));

const now = () => Math.floor(Date.now() / 1000);

export async function mintToken(opts: MintOptions = {}): Promise<string> {
  const jwk = JSON.parse(opts.privateJwk ?? env.TEST_ACCESS_PRIVATE_JWK) as JWK & { kid: string };
  const key = await importJWK(jwk, "RS256");
  const iat = opts.iat ?? now();
  const payload: Record<string, unknown> = { type: "app", identity_nonce: crypto.randomUUID(), country: "US", ...opts.claims };
  if (opts.email !== undefined) payload["email"] = opts.email;
  if (opts.commonName !== undefined) payload["common_name"] = opts.commonName;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? jwk.kid })
    .setIssuer(opts.iss ?? testIssuer())
    .setAudience(opts.aud ?? [testAudience()])
    .setSubject(opts.sub ?? (opts.commonName !== undefined ? "" : crypto.randomUUID()))
    .setIssuedAt(iat)
    .setNotBefore(opts.nbf ?? iat)
    .setExpirationTime(opts.exp ?? iat + 3600)
    .sign(key);
}

/** An Access service token: empty sub, common_name instead of email. */
export function mintServiceToken(commonName: string, opts: MintOptions = {}): Promise<string> {
  return mintToken({ ...opts, commonName, sub: "" });
}

export async function mintHs256(email: string): Promise<string> {
  const secret = new TextEncoder().encode("an-hs256-secret-that-is-long-enough-for-jose");
  const iat = now();
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(testIssuer())
    .setAudience([testAudience()])
    .setSubject(crypto.randomUUID())
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(secret);
}

export function unsignedToken(email: string): string {
  const iat = now();
  const enc = (o: unknown) => base64url.encode(JSON.stringify(o));
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({
    email,
    iss: testIssuer(),
    aud: [testAudience()],
    sub: crypto.randomUUID(),
    iat,
    exp: iat + 3600,
  })}.`;
}

/** Re-encodes the payload of a signed token with a changed email, keeping the old signature. */
export function tamperEmail(token: string, email: string): string {
  const [h, p, s] = token.split(".");
  const payload = JSON.parse(new TextDecoder().decode(base64url.decode(p ?? ""))) as Record<string, unknown>;
  payload["email"] = email;
  return `${h}.${base64url.encode(JSON.stringify(payload))}.${s}`;
}

/** A private JWK (JSON) for a key the server does not trust. */
export async function foreignPrivateJwk(kid = "foreign-key"): Promise<string> {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  return JSON.stringify({ ...(await exportJWK(privateKey)), kid, alg: "RS256" });
}
