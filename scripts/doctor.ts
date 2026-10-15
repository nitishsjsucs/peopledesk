// npm run doctor
//
// Read-only check of the production deployment: the wrangler login and CF_API_TOKEN, every Cloudflare
// resource npm run setup:production creates (D1 and its seeded dataset, R2, AI Search, AI Gateway, the
// Worker, the Access identity provider, service tokens, policies and application), whether
// wrangler.jsonc matches them, and two HTTP probes of https://<APP_HOSTNAME>/api/health: without
// credentials Access must stop the request, and with a persona's service token the Worker must answer
// (403 outside an eval window, when ALLOW_SERVICE_TOKENS is false; 200 inside one). It changes nothing
// and prints no secret. Exit code 0 when everything is in place, 1 otherwise.
import { inspect, PROD, printFindings, readServiceTokens } from "./lib/production.ts";

const state = await inspect();
const findings = state.findings;

const url = `https://${PROD.hostname}/api/health`;
try {
  const res = await fetch(url, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  const stopped = (res.status === 302 || res.status === 303) && location.startsWith(PROD.teamDomain);
  findings.push({
    area: "Access in front",
    ok: stopped || res.status === 401 || res.status === 403,
    detail: stopped ? `unauthenticated request redirected to ${PROD.teamDomain}` : `unauthenticated request answered HTTP ${res.status}${location ? ` (to ${location.slice(0, 60)})` : ""}`,
  });
} catch (err) {
  findings.push({ area: "Access in front", ok: false, detail: `${url}: ${String(err)}` });
}

const token = readServiceTokens().tenured_employee;
if (token) {
  try {
    const res = await fetch(url, { headers: { "CF-Access-Client-Id": token.clientId, "CF-Access-Client-Secret": token.clientSecret }, redirect: "manual" });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: { code?: string }; asOf?: string; datasetSha256?: string } | null;
    const reached = res.status === 200 || (res.status === 403 && body?.error?.code === "forbidden");
    findings.push({
      area: "Worker behind Access",
      ok: reached,
      detail:
        res.status === 200
          ? `service token answered 200 (eval window open): business date ${body?.asOf}, dataset ${body?.datasetSha256?.slice(0, 12)}`
          : res.status === 403 && body?.error?.code === "forbidden"
            ? "service token reached the Worker, which refused it (ALLOW_SERVICE_TOKENS false): Access JWT verified"
            : res.status === 500
              ? "HTTP 500: the Worker is misconfigured (ACCESS_AUD not set yet?)"
              : `HTTP ${res.status} ${body?.error?.code ?? ""}`,
    });
  } catch (err) {
    findings.push({ area: "Worker behind Access", ok: false, detail: String(err) });
  }
} else {
  findings.push({ area: "Worker behind Access", ok: false, detail: "no saved service token secret to probe with (npm run setup:production)" });
}

printFindings(findings);
const todo = findings.filter((f) => !f.ok).length;
console.log(todo === 0 ? "\nEverything is in place." : `\n${todo} item(s) to fix; npm run setup:production -- --dry-run shows what it would do.`);
process.exit(todo === 0 ? 0 : 1);
