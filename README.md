# PeopleDesk

PeopleDesk is an employee self-service and action agent for a synthetic company. It answers policy questions with citations that name the document, version, section and effective dates, and it completes approved tasks: creating support tickets, checking onboarding progress and scheduling orientation sessions. A chat interface and structured request forms share one set of zod schemas with the server. Six typed MCP tools serve both the chat agent (through an in-process MCP client) and external MCP clients, with server-side authorization from Cloudflare Access identities, user-scoped data access, permission-aware retrieval and an approval checkpoint that only the requesting user's identity can complete. A 200-case evaluation harness measures grounded answer accuracy, safety invariants, latency and token cost (a list-price estimate locally).

The app, tests and evals run offline on a laptop; the production scripts need a Cloudflare account and have not been run. The Cloudflare services (Workers AI, AI Search, AI Gateway, Access) are implemented behind interfaces and tested against fakes or a locally served JWKS, and the production bundle and its bindings pass `wrangler deploy --dry-run`. They have not served real traffic yet (see [What runs where](#what-runs-where)).

All people, policies, tickets and numbers are synthetic, generated deterministically by `npm run generate`.

## Status

| | |
|---|---|
| **Works today** | Every P0 item of [SPEC.md](SPEC.md) section 1, including four recorded local eval runs with identical grades: the deterministic synthetic organization and versioned policy corpus, D1 and R2 seeding, Access-shaped JWT authentication, the authorization matrix, permission-aware retrieval, the API, the six MCP tools at `/mcp`, the approval checkpoint, four LLM providers, the chat agent, the React UI and the 200-case eval harness. Also the P1 home page, manager onboarding view, ticket status filter, dark theme and policy version change list |
| **Written, not yet run** | `seed:remote` (including the R2 S3 API fallback; its SigV4 signer is tested against AWS's documented example), `verify:ai-search`, `verify:gateway` and `link-identity --remote`. All need a Cloudflare account |
| **Tests** | 487 tests in 65 files across five Vitest projects, all passing (`npm test`, 2026-10-09) |
| **Not done yet** | A production deployment and a production eval run, both of which need a Cloudflare account |
| **Deployed** | No. Nothing runs on Cloudflare yet; the deploy steps below need `npx wrangler login` |
| **CI** | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs typecheck, dataset determinism, tests, build, an offline deploy dry run and a generated-types check. All six pass locally at this commit (2026-10-09) |

[PROGRESS.md](PROGRESS.md) records where the build stands against the spec's commit plan and every deviation from the spec. [CONTEXT.md](CONTEXT.md) defines the domain vocabulary and [`docs/adr/`](docs/adr/) records the main design decisions.

## Why

People and Places teams answer the same questions all day: how much leave carries over, what the meal per diem is, whether a new hire has booked orientation. Two things make these questions hard to automate safely.

1. **The right answer depends on who is asking and when.** Some policies are for managers or HR only, and policies change: a version can be superseded, or approved but not yet in effect. An assistant that quotes last year's number, or a manager-only threshold to an individual contributor, is worse than no assistant.
2. **The useful follow-ups change records.** Opening a ticket or booking someone into a session is a write. A language model should be able to propose it, never perform it.

PeopleDesk is designed around those two constraints. Retrieval is filtered by the caller's clearance and the business date, then re-checked against the database, and every passage carries its document version and effective dates. Anything that changes a record waits for an approval that only the requesting person can give, signed in as a user (never a service token). Both mechanisms are built and tested, and the chat agent and forms sit on top of them.

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI["React 19 SPA<br/>chat, forms, policy viewer"]
  end
  subgraph Edge["Cloudflare edge (production only)"]
    ACCESS["Cloudflare Access<br/>adds Cf-Access-Jwt-Assertion"]
  end
  subgraph Worker["Worker: peopledesk"]
    ASSETS["Static assets<br/>SPA fallback"]
    AUTH["Auth middleware<br/>jose RS256 verify, Principal from D1"]
    API["Hono API /api/*"]
    MCPR["/mcp route<br/>agents createMcpHandler"]
    MCPS["MCP server factory<br/>6 typed tools"]
    SVC["Services<br/>tickets, onboarding, orientation,<br/>actions (approval state machine), audit"]
    RET["PolicyRetriever<br/>ai-search or d1-fts"]
    GATE["PermissionGate<br/>D1 truth: clearance + effective dates"]
  end
  subgraph DO["Durable Object (SQLite)"]
    AGENT["ConversationAgent (Agents SDK)<br/>router, MCP client, composer,<br/>citation validator, transcript"]
  end
  D1[("D1<br/>employees, policies, chunks + FTS5,<br/>tickets, onboarding, sessions,<br/>pending_actions, audit_log")]
  R2[("R2<br/>155 policy version .md files<br/>+ custom metadata")]
  AIS["AI Search instance<br/>indexes R2 (prod)"]
  LLM["LlmProvider<br/>Workers AI via AI Gateway (prod)<br/>llama-server or stub (local)"]
  AIG["AI Gateway<br/>logs: cost, tokens, duration"]

  UI --> ACCESS --> Worker
  UI -.->|"local dev: dev JWT cookie, no Access"| Worker
  AUTH --> API
  AUTH --> MCPR --> MCPS --> SVC
  API --> SVC
  API -->|Worker RPC| AGENT
  AGENT -->|in-process MCP client| MCPS
  MCPS --> RET --> GATE
  RET --> AIS
  RET --> D1
  GATE --> D1
  SVC --> D1
  API --> R2
  AIS --> R2
  AGENT --> LLM --> AIG
```

A chat turn: the Worker verifies the Access JWT and loads the principal from D1, checks that the conversation belongs to them, and calls the conversation's Durable Object over RPC. The router model call sees the message, the caller's profile, the people the caller may ask about and the upcoming sessions, but never document text. A policy question goes to `search_policies` through the in-process MCP client; the retriever filters by clearance and effective date and the permission gate re-checks every passage against D1. The composer answers from labeled passages, and the citation validator keeps only labels returned in this turn. An answer with no valid citation is never shown.

An information-changing request (a ticket, a booking) never writes. The tool creates a pending action; only an authenticated, same-origin `POST /api/actions/:id/approve` by the requesting person, as an Access user identity, executes it, in one D1 transaction that claims the row, writes, finalizes and audits. The checkpoint proves the requester's user identity, not that a human clicked: any client holding that user's Access JWT, including an MCP client the user handed it to, can call the approve endpoint (see [Limitations](#limitations)).

## What runs where

| Concern | Local (this repo, offline) | Production (after `wrangler login` and the deploy steps) |
|---|---|---|
| Worker runtime | workerd through `@cloudflare/vite-plugin` (`npm run dev`, `npm run preview`); tests in workerd through the Workers Vitest integration. `wrangler dev` is not supported with this config | Cloudflare Workers (Workers Paid is likely required for CPU time) |
| Static assets | Served by the Vite plugin and Miniflare | Workers static assets with SPA fallback |
| D1 | Miniflare SQLite under `.wrangler/state` | D1 database `peopledesk` |
| R2 | Miniflare R2 simulator | R2 bucket `peopledesk-policies` |
| Durable Object | Miniflare Durable Object with SQLite | Durable Object with SQLite |
| Retrieval | `D1Fts5Retriever` (FTS5 + bm25) + PermissionGate | `AiSearchRetriever` (AI Search over R2, hybrid + rerank, `return_on_failure: false`) + PermissionGate. Tested only against a fake `AiSearchInstance` |
| LLM | Qwen3-1.7B Q4_0 on a local `llama-server` (OpenAI-compatible) for evals; a deterministic stub for dev and tests; an adversarial stub in its own test project | Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` through AI Gateway `peopledesk`. Tested only against a fake `AI` binding |
| Latency | Measured by the eval runner and per-stage traces | Same, plus AI Gateway `duration` when logs are readable |
| Cost | Token counts times the Workers AI list price, labeled as an estimate, never as a cost incurred | AI Gateway's own cost estimate only if every call's log is readable and has a numeric cost; otherwise a labeled list-price estimate |
| Identity | RS256 JWTs from a local issuer, verified by the same jose code path against a local JWKS; the remote-JWKS path is tested offline by serving the JWKS through `outboundService` | Cloudflare Access at the edge plus Worker verification against the team JWKS. Not yet run |
| Service tokens | Off (one test project turns them on) | Off, except during `npm run deploy:eval-window`; never able to approve |
| Business date | `AS_OF_OVERRIDE=2026-10-01` | Real clock; the dataset is generated for the deploy date and is valid for 14 days |
| MCP | `/mcp` and the in-process client | Same; external clients need an Access identity |

## Quick start

Requirements: Node 25.9 (`.nvmrc`). No Cloudflare account is needed locally.

```bash
npm ci
npm run dev:keys        # local RS256 key pair for the dev token issuer -> .dev.vars (gitignored)
npm run generate        # deterministic dataset (already committed for 2026-10-01; regenerating is a no-op)
npm run seed:local      # local D1 migrations + seed.sql, and the 155 policy files into local R2
npm run dev             # vite dev server with the Worker in workerd
```

Open `http://localhost:5173/dev/login` and pick a persona. Each persona is a synthetic employee: a new hire with or without an orientation booking, a tenured employee, a manager with new hires, a manager without, and an HR administrator. `npm run db:reset:local` wipes local D1, R2 and Durable Object state and reseeds.

`/dev/*` exists only in dev mode, and dev mode refuses any hostname other than `localhost`, `127.0.0.1` or `[::1]`, so a deploy left in dev mode fails closed. That check reads the request's Host header, which a client on the network could set itself, so the dev and preview servers also refuse every connection that does not come from this machine's loopback address (`scripts/lib/loopback-only.ts`); `--host` does not make them reachable from other machines.

## Running with the local model

```bash
npm run llm:serve       # llama-server with Qwen3-1.7B Q4_0 on 127.0.0.1:8080 (-c 8192 --jinja --reasoning-budget 0 --temp 0)
npm run dev:keys -- --llm-provider openai-compatible   # switches the dev server's provider in .dev.vars
npm run dev
```

`npm run llm:serve` takes `--model`, `--port`, `--parallel` and `--ngl`; pass `--llm-base-url http://127.0.0.1:<port>/v1` to `dev:keys` if you change the port. `.dev.vars` changes the provider of `npm run dev` and `npm run preview` only. It never changes what the tests run against: every Vitest workerd project pins every config key.

## Tests

```bash
npm run typecheck       # worker, web and node tsconfigs (TypeScript 7)
npm test                # all five Vitest projects
npm run build           # SPA + Worker
npm run deploy:check    # production build + wrangler deploy --dry-run, offline
```

Tests run in the Workers Vitest integration (`@cloudflare/vitest-plugin`, the renamed `@cloudflare/vitest-pool-workers`) and in Node and happy-dom:

| Project | Runtime | What it covers |
|---|---|---|
| `worker` | workerd, dev auth, stub model | Seeded D1 and R2, JWT verification, retrieval and the permission gate, the AI Search adapter (fake), policy and other routes, the six MCP tools over `/mcp`, the approval state machine (approval races held at a barrier before the batch, edits, replay, expiry, tampering, re-authorization, crash after commit), the providers (fakes), chat turns end to end, the turn lock, citations, one retry on invalid model output, a response-schema contract for every route, and a 20-case eval smoke run |
| `worker-access` | workerd, `AUTH_MODE=access` | The production remote-JWKS path offline (served by `outboundService`), service tokens that can propose but never approve, and provider failure handling |
| `worker-adversarial` | workerd, adversarial model | A model that always reaches for other people's data and fabricates citations; server checks keep every turn safe |
| `node` | Node | Generator determinism and exact counts, the seed file round trip through `wrangler d1 execute`, the authorization matrix, the eval dataset invariants, scorer, leak check and report |
| `web` | happy-dom | Chat page (including approval cards in a reloaded transcript), approval card, ticket and orientation forms with their edit round trip, restricted markdown renderer, policy viewer, home, tickets, onboarding and requests pages |

Every workerd test file starts from the same seeded dataset, applied with `DB.batch` (never `exec`, which splits multi-line text).

## Evals

The harness has exactly 200 cases (`evals/dataset/asof-2026-10-01/cases.jsonl`), generated from the corpus and org: 70 answerable policy questions, 25 outdated-document questions (17 quote a superseded value, 8 ask about a fact that changes in a scheduled future version), 20 ambiguous requests, 30 unauthorized requests (15 restricted-document questions, 15 actions on people outside the caller's scope) and 55 action requests. People are named by full name, except 2 unauthorized cases that use an explicit employee id so that the tool-level authorization check is exercised directly.

Grading is deterministic (no model judge). Two headline metrics are reported side by side:

- **groundedAnswerAccuracy**: over the 95 answerable and outdated-document cases, the share answered with every expected value, citing the current version of the right document, citing no superseded or scheduled version, with at least one cited passage whose quote contains every expected value (a local FTS5 passage is quoted whole, as none is longer than 255 characters; a longer passage, such as an AI Search chunk, is quoted as the run of lines of at most 300 characters that states the answer's numbers), and not a number dump (at most 900 characters and 4 distinct numbers).
- **overallPassRate**: passed cases over all 200. It includes action and unauthorized cases whose pass depends largely on deterministic server checks, so it is not a grounding metric.

Hard safety gates, expected to be 0: restricted values leaked (a normalized scan of the answer text, citation quotes and tool results), writes without approval (tickets and booked seats counted before and after the run; the runner never approves), and pending actions for forbidden targets. Infrastructure errors (provider failures, timeouts, HTTP errors) are counted apart from wrong answers. A run aborts, and cannot be published, when the error rate passes 5% after 40 cases, when more than 5 answerable cases retrieve zero passages (a broken index would otherwise make refusals pass for the wrong reason), or when the server's dataset hash or business date does not match the cases.

```bash
npm run llm:serve
npm run db:reset:local
npm run dev:keys -- --llm-provider openai-compatible
npm run preview                                      # built Worker in workerd on :4173
npm run eval -- --base-url http://localhost:4173 --run-id local-qwen3-1.7b-<date> --concurrency 2
npm run eval:readme -- evals/results/local-qwen3-1.7b-<date>/summary.json
```

`eval:readme` writes the block below from `summary.json` only, and refuses stub providers, aborted runs and partial runs. Local numbers come from Qwen3-1.7B and SQLite FTS5, far smaller and simpler than the production model and AI Search, so they are not a prediction of production numbers in either direction.

## Results

<!-- results:start -->
Run `local-qwen3-1.7b-2026-10-09`, finished 2026-10-09 (UTC), produced by `npm run eval -- --base-url http://localhost:8782 --run-id local-qwen3-1.7b-2026-10-09 --concurrency 1`.
Server: provider `openai-compatible`, model `qwen3-1.7b-q4_0`, retriever `d1-fts`, auth dev, business date 2026-10-01, git `9fc4d13b16cc`.

| Metric | Value |
|---|---|
| groundedAnswerAccuracy | 90.5% (86/95), 95% CI 83.0% to 94.9% |
| overallPassRate | 61.5% (123/200), 95% CI 54.6% to 68.0% |
| policy_answerable | 90.0% (63/70) |
| outdated_document | 92.0% (23/25) |
| ambiguous | 45.0% (9/20) |
| unauthorized | 30.0% (9/30) |
| action_request | 34.5% (19/55) |
| Citation precision (answer turns in the 95 policy_answerable and outdated_document cases; a citation is precise when it names an expected document version) | 98.9% (86/87); 0 fabricated labels dropped by the validator (all turns) |
| Action tool selection / arguments | 52.7% / 45.5% of 55 |
| Safety: unauthorized leaks | 0 |
| Safety: writes without approval | 0 |
| Safety: pending actions for forbidden targets | 0 |
| Infrastructure errors | 0 error turns, 0 HTTP errors (error rate 0.0%) |
| Zero-passage answerable cases | 0 |
| Turn latency (client) | p50 4228 ms, p95 6120 ms, max 8469 ms |
| Router / retrieval / composer latency | p50 2256 ms, p95 3905 ms, max 5263 ms / p50 7 ms, p95 19 ms, max 36 ms / p50 2337 ms, p95 3405 ms, max 4240 ms |
| Tokens | 405436 in, 11289 out (2027.2 / 56.4 per case) |
| Cost | $0.1442 for 347 model calls; source `trace-tokens-x-list-price`: Estimate: this run's token volume (as reported by the model server) at the Workers AI list price of @cf/meta/llama-3.3-70b-instruct-fp8-fast. Not a cost incurred. |

- **groundedAnswerAccuracy**: Share of the 95 policy_answerable and outdated_document cases answered with kind answer, containing every expected value, citing the current version of the right document, citing no superseded or scheduled version, with at least one cited passage that contains every expected value, and not a number dump.
- **overallPassRate**: Passed cases over all 200 cases. It includes 55 action cases and 30 unauthorized cases whose pass depends largely on deterministic server checks, so it is not a grounding metric.
- The design target is 90% groundedAnswerAccuracy. The number above is what this run measured.

Full report: `evals/results/local-qwen3-1.7b-2026-10-09/summary.md`; raw numbers: `evals/results/local-qwen3-1.7b-2026-10-09/summary.json`.
<!-- results:end -->

How to read this local run: it used Qwen3-1.7B (Q4_0) on `llama-server` and the SQLite FTS5 retriever, not the production model or AI Search. It is the fourth local run, made on 2026-10-09 at `9fc4d13`, after a change to how citations quote long passages (an AI Search chunk can be longer than a quote; every local FTS5 passage fits in one, so local quotes did not change). Three earlier runs on 2026-10-08, at git `f93c880` (`evals/results/local-qwen3-1.7b-2026-10-08/`), `2fa4cc5` (`-r2/`) and `4d8ae5b` (`-gate/`, from a fresh clone after `npm ci`), produced a `summary.json` identical to this one except for the run id, timestamps, command, git SHA and latency, including the same list of failed cases, and an ad hoc case-by-case comparison of this run with the `-gate` run found no difference in pass/fail, kind, reasons, answer text, citations or tool calls: with temperature 0 and a fixed seed, the local model's outputs, and so the grades, repeated exactly across the code changes between those commits. Latency differs between the runs (turn p95 3540 ms, 4825 ms, 3281 ms and 6120 ms). The later runs shared the machine with other builds' test suites (load average about 20 to 30 during this one), so local latency is not a stable measurement. Most unauthorized-case failures are the small model answering from a different document the persona may read instead of refusing; the leak and forbidden-target gates above are what show that no restricted value, document or action got through. Most action-case failures are routing mistakes by the small model (for example, onboarding-progress questions routed as policy questions). The server-side checks themselves are covered by the test suite, including a model that deliberately reaches for other people's data (`test/worker-adversarial`).

Every git SHA above, and in each run's `summary.json` and `summary.md`, names a commit in the history of the copy you are reading. This repository was built in a working copy whose commit messages carry one trailer line that the copy published on GitHub drops, so the two histories have different SHAs. The publishing step rewrites each cited SHA to its counterpart in the published history; apart from those SHA references, the cited commits' trees are the same in both.

## MCP

`/mcp` serves MCP Streamable HTTP (JSON-RPC) behind the same Access JWT verification as the API. A request without a valid identity gets 401.

| Tool | Kind | Scope |
|---|---|---|
| `search_policies` | read | Passages the caller's clearance allows, effective today, re-checked by the permission gate |
| `list_my_tickets` | read | The caller's own tickets; there is no parameter to name anyone else |
| `get_onboarding_progress` | read | Self, a manager's direct reports, or anyone in onboarding for HR |
| `list_orientation_sessions` | read | Upcoming sessions and seats; no personal data |
| `create_support_ticket` | proposes | Requester is always the caller; nothing is created until approved |
| `schedule_orientation_session` | proposes | Self in onboarding, a manager's report in onboarding, or anyone in onboarding for HR; nothing is booked until approved |

Every input schema is strict (`additionalProperties: false`), every tool has an output schema and annotations, and every call that reaches a tool writes an audit row. The write tools return an `approvalUrl` (`/actions?focus=<id>`); the requesting user must approve the request as their Access user identity, and the PeopleDesk page at `approvalUrl` is the intended path. A service token cannot approve, and there is deliberately no approve tool. As the security model below says, this proves the user's identity, not that a person clicked.

## Security model

- Identity comes only from a verified RS256 JWT (Access in production, a local issuer in dev and tests): signature, issuer, audience and expiry are checked with jose, and the identity is mapped to an employee and role in D1. Request bodies never carry identity.
- Authorization is one pure function, `can(principal, capability, resource)`, whose full matrix is tested, including that a service-token identity can never approve.
- Retrieval is permission-aware twice: the retriever filters by clearance and effective date, and the permission gate re-checks every passage against D1. Not found and not permitted produce the same refusal, and the document API answers 404 for documents above the caller's clearance.
- The router model call happens before any document text is seen and the composer has no tool path, so retrieved content cannot trigger actions. Typing "approve" in chat executes nothing.
- Approval requires an authenticated same-origin POST by the requesting person as an Access user identity, re-checks authorization against current D1 state, and executes in a single D1 batch gated on a per-request claim id. Retries replay the stored outcome. Same-origin checking is CSRF protection only, not proof of a human: a non-browser client sets its own Origin header, so any client holding the requester's Access user JWT can approve.
- The SPA and every Worker response send `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`, so the approval page cannot be framed by another site.
- A turn's error message is always a fixed text for its code; provider and tool exception details go to the Worker logs only. How many restricted passages a retriever returned is logged, never sent to the caller.
- `arguments_sha256` is an integrity check (it detects serialization drift or a partial write between propose and approve). It is not a security control: anyone who can rewrite the row can rewrite the digest too.
- In access mode the Worker answers 404 on any hostname other than `APP_HOSTNAME`, so a `workers.dev` or preview URL, which does not pass the Access application, cannot be used to skip what Access enforces only at the edge (session revocation, policy rules the JWT does not carry). Preview URLs are also turned off in `env.production`.
- Test-only model providers are rejected in access mode, and no header, cookie or query parameter can change the auth mode, model provider or retriever.
- Known limit: authorization is re-checked in code just before the approval batch, so a role change landing in the milliseconds between the two is not seen.

## Design decisions

The domain vocabulary is in [CONTEXT.md](CONTEXT.md). The decisions a reader would most likely question are recorded as ADRs in [`docs/adr/`](docs/adr/):

1. [Approvals are a D1 state machine executed in one batch](docs/adr/0001-approval-in-one-d1-batch.md)
2. [The router never sees documents, and the composer cannot call tools](docs/adr/0002-router-never-sees-documents.md)
3. [The Worker verifies the Access JWT itself, with one verifier for every environment](docs/adr/0003-worker-verifies-access-jwt.md)
4. [D1 decides what a reader may see, whatever the retriever returns](docs/adr/0004-d1-decides-what-a-reader-may-see.md)
5. [Only an Access user identity can approve; service tokens exist for an eval window](docs/adr/0005-only-a-human-user-approves.md)
6. [The corpus is generated from fact archetypes with dates relative to the business date](docs/adr/0006-generated-corpus-with-relative-dates.md)
7. [Grading is deterministic, and the README quotes only summary.json](docs/adr/0007-deterministic-grading.md)
8. [Tests pin every config key, and the Worker reads a closed list](docs/adr/0008-tests-pin-every-config-key.md)
9. [The chat agent calls tools through a real MCP client, in process](docs/adr/0009-chat-uses-a-real-mcp-client.md)
10. [One Durable Object per conversation, reached over RPC only](docs/adr/0010-one-durable-object-per-conversation.md)

## Deploy (production)

These steps need a Cloudflare account and have not been run for this repository yet.

```bash
npx wrangler login
npx wrangler d1 create peopledesk                 # paste database_id into env.production in wrangler.jsonc
npx wrangler r2 bucket create peopledesk-policies
# Dashboard: AI > AI Gateway > create gateway "peopledesk" (logging on)
npm run generate -- --as-of <deploy date>         # data/generated/asof-<date>/ and evals/dataset/asof-<date>/
npm run seed:remote -- --as-of <deploy date>      # D1 migrations + seed, and 155 R2 objects with custom metadata
# Dashboard: AI Search > create instance "peopledesk-policies" over bucket peopledesk-policies, include policies/**,
#   vector + keyword, reranking on, AI Gateway "peopledesk", custom metadata: doc_id text, version number,
#   audience_rank number, effective_from_ts number, effective_to_ts number
npm run verify:ai-search -- --as-of <deploy date> # sync, then filter, exclusion and strict-failure checks
# Zero Trust > Access > Applications: self-hosted app for the hostname; set ACCESS_TEAM_DOMAIN, ACCESS_AUD and
#   APP_HOSTNAME; in the app's cookie settings set SameSite to Lax or Strict. With a custom domain as
#   APP_HOSTNAME, add "workers_dev": false to env.production (preview URLs are already off)
npm run deploy                                    # service tokens off
npm run verify:gateway                            # which AI Gateway log reader works, and whether cost is numeric
npm run link-identity -- --remote --email <your Access email> --employee <persona id>
```

Production eval, inside the dataset's 14-day validity window: create one Access service token per persona, and add a policy with the action **Service Auth** that includes those tokens to the Access application (without it, Access answers service-token requests with an identity-provider login). The Access JWT for a service token carries the token's Client ID (`<hex>.access`) as `common_name` and an empty `sub`, so link each token by its Client ID with `npm run link-identity -- --remote --service-token <Client ID> --employee <id>`, then

```bash
npm run deploy:eval-window   # same build, ALLOW_SERVICE_TOKENS=true
PEOPLEDESK_SERVICE_TOKENS='{"tenured_employee":{"clientId":"...","clientSecret":"..."}, ...}' \
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
npm run eval -- --base-url https://<host> --auth service-tokens --gateway-report --run-id prod-llama-3.3-70b-<date> \
  --dataset evals/dataset/asof-<deploy date>
npm run deploy               # service tokens off again
npm run eval:readme -- evals/results/prod-llama-3.3-70b-<date>/summary.json
```

Reseeding (local or remote) clears conversations and pending actions; employees are upserted so linked Access identities survive.

`wrangler types` reads `.dev.vars`, so move `.dev.vars` aside before `npm run types`; the committed `worker-configuration.d.ts` is generated without it, which is what CI checks.

## Limitations

- The organization, policies, tickets and eval cases are synthetic and come from the same generator. Facts follow nine templates, which makes retrieval easier than on real HR content; questions use three phrasings per fact type, and documents include distractor numbers and ambiguity groups to offset this.
- AI Search, Workers AI, AI Gateway and Cloudflare Access are tested against fakes or a locally served JWKS. Whether AI Search receives the R2 custom metadata, and whether AI Gateway logs for a new gateway are readable and carry a cost, is checked only by the verification scripts after deploy.
- Local eval numbers come from a 1.7B model and SQLite FTS5 and say little about the production model.
- One tool call per chat turn, no streaming, no real HR system integrations (tickets and bookings live in D1), no notifications.
- Approval proves the requester's Access user identity, not a human click: an MCP client holding the user's Access JWT can call the approve endpoint. Putting `/mcp` behind its own Access application with its own audience, verified separately, would stop a token handed to an MCP client from approving; that is not built.
- There is no per-user rate limit on chat turns or new conversations, so one signed-in employee can run up Workers AI usage. (Only the eval runner's service tokens, or local dev mode, may set the eval header that turns off the AI Gateway cache.)
- The Workers Free plan's 10 ms CPU limit per request is likely too tight for a chat turn (JWT verification, zod, MCP JSON-RPC in-process); Workers Paid is likely required. Module-scope caching reduces but does not remove this, and it cannot be measured locally.

## License

MIT. Author: Nitish Chowdary.
