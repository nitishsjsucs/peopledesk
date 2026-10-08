// AWS Signature Version 4 for single S3 requests (R2's S3-compatible API), with Web Crypto only.
// Used by the R2 S3 API fallback in seed-remote: `wrangler r2 object put` has no custom-metadata option,
// and the S3 API carries custom metadata as x-amz-meta-* headers.

const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

/** RFC 3986 encoding as S3 expects: unreserved characters stay, everything else is %XX (uppercase). */
export function uriEncode(value: string, keepSlash: boolean): string {
  let out = "";
  for (const byte of enc.encode(value)) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(ch) || (keepSlash && ch === "/")) out += ch;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export type SignInput = {
  method: string;
  url: string;
  /** Headers to sign (host is added from the URL). Names are case-insensitive. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the body, or "UNSIGNED-PAYLOAD". */
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  /** YYYYMMDD'T'HHMMSS'Z'. */
  amzDate: string;
};

export async function signRequest(i: SignInput): Promise<{ authorization: string; headers: Record<string, string>; canonicalRequest: string }> {
  const url = new URL(i.url);
  const service = i.service ?? "s3";
  const date = i.amzDate.slice(0, 8);
  const all: Record<string, string> = { host: url.host, "x-amz-date": i.amzDate, "x-amz-content-sha256": i.payloadHash };
  for (const [k, v] of Object.entries(i.headers)) all[k.toLowerCase()] = v;
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(all[n]).trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k, false), uriEncode(v, false)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const path = uriEncode(decodeURIComponent(url.pathname), true);
  const canonicalRequest = [i.method, path, query, canonicalHeaders, signedHeaders, i.payloadHash].join("\n");
  const scope = `${date}/${i.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", i.amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  let key = await hmac(enc.encode(`AWS4${i.secretAccessKey}`), date);
  key = await hmac(key, i.region);
  key = await hmac(key, service);
  key = await hmac(key, "aws4_request");
  const signature = hex(await hmac(key, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`;
  return { authorization, headers: { ...all, authorization }, canonicalRequest };
}

export function amzDateOf(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
