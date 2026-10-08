// Verifies Access-shaped RS256 JWTs. One class, two key sources, one code path:
// - production (AUTH_MODE=access): createRemoteJWKSet on <team domain>/cdn-cgi/access/certs;
// - dev and tests (AUTH_MODE=dev): createLocalJWKSet on DEV_ACCESS_JWKS.
// Key sources are cached at module scope so jose's JWKS cache survives across requests.
import { createLocalJWKSet, createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
import type { JWTPayload, JWTVerifyGetKey } from "jose";
import type { AuthConfig } from "../env.ts";

export type VerifiedIdentity =
  | { kind: "user"; email: string; sub: string; claims: JWTPayload }
  | { kind: "service_token"; commonName: string; claims: JWTPayload };

/** A verification failure. `reason` is a stable code for logs; clients only ever see 401. */
export class IdentityError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "IdentityError";
    this.reason = reason;
  }
}

export class JwtIdentityVerifier {
  private readonly keys: JWTVerifyGetKey;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(opts: { keys: JWTVerifyGetKey; issuer: string; audience: string }) {
    this.keys = opts.keys;
    this.issuer = opts.issuer;
    this.audience = opts.audience;
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    let unverified: JWTPayload;
    try {
      unverified = decodeJwt(token);
    } catch {
      throw new IdentityError("malformed_token");
    }
    // Service tokens carry common_name and an empty sub (Access application-token docs), so `sub`
    // is only required for user identities. The signature is still verified for both.
    const looksLikeServiceToken = typeof unverified["common_name"] === "string" && !unverified["email"];
    let claims: JWTPayload;
    try {
      ({ payload: claims } = await jwtVerify(token, this.keys, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ["RS256"],
        clockTolerance: 30,
        requiredClaims: looksLikeServiceToken ? ["exp", "iat"] : ["exp", "iat", "sub"],
      }));
    } catch (err) {
      const code = (err as { code?: string }).code ?? "verify_failed";
      throw new IdentityError(code);
    }
    const email = claims["email"];
    const commonName = claims["common_name"];
    if (typeof email === "string" && email.includes("@")) {
      if (typeof claims.sub !== "string" || claims.sub.length === 0) throw new IdentityError("missing_sub");
      return { kind: "user", email: email.toLowerCase(), sub: claims.sub, claims };
    }
    if (typeof commonName === "string" && commonName.length > 0) {
      return { kind: "service_token", commonName, claims };
    }
    throw new IdentityError("no_identity_claim");
  }
}

const remoteKeySets = new Map<string, JWTVerifyGetKey>();
const localKeySets = new Map<string, JWTVerifyGetKey>();
const verifiers = new Map<string, JwtIdentityVerifier>();

function keySourceFor(auth: AuthConfig): JWTVerifyGetKey {
  if (auth.mode === "access") {
    let keys = remoteKeySets.get(auth.teamDomain);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`${auth.teamDomain}/cdn-cgi/access/certs`));
      remoteKeySets.set(auth.teamDomain, keys);
    }
    return keys;
  }
  const fingerprint = JSON.stringify(auth.jwks);
  let keys = localKeySets.get(fingerprint);
  if (!keys) {
    keys = createLocalJWKSet(auth.jwks as Parameters<typeof createLocalJWKSet>[0]);
    if (localKeySets.size > 8) localKeySets.clear();
    localKeySets.set(fingerprint, keys);
  }
  return keys;
}

/** Module-scope verifier per auth config (CPU budget: no per-request key parsing). */
export function verifierFor(auth: AuthConfig): JwtIdentityVerifier {
  const key = JSON.stringify([auth.mode, auth.issuer, auth.audience, auth.mode === "access" ? auth.teamDomain : auth.jwks]);
  let v = verifiers.get(key);
  if (!v) {
    v = new JwtIdentityVerifier({ keys: keySourceFor(auth), issuer: auth.issuer, audience: auth.audience });
    if (verifiers.size > 8) verifiers.clear();
    verifiers.set(key, v);
  }
  return v;
}
