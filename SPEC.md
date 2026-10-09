# PeopleDesk v1: Employee Self-Service and Action Agent

Historical design spec (revision 2, written before the build). Current status is in README.md and PROGRESS.md, and deviations from this spec are listed in PROGRESS.md; the scratchpad probes cited in the review log are not part of this repository.

The resume text in section 0 is the target, not a description of what has run: Workers AI, AI Search, AI Gateway and Cloudflare Access have not run yet. Do not use it until the deploy steps in section 18 and a production eval have run; PROGRESS.md ("Resume claims") has interim wording that is true today.

Status: design spec, revision 2 (2026-10-08). Revision 2 resolves the review findings listed in section 24 (Review log). Nothing in this repository exists yet except this file.
Repo: `~/Developer/projects/peopledesk`, to be pushed as `github.com/nitishsjsucs/peopledesk`.
Author of record: Nitish Chowdary (MS SE, SJSU). Built from scratch; no code from any earlier implementation is reused.

This spec is the contract for the build phase. Every number and mechanism in the resume text below is an acceptance criterion and maps to a test or an eval in section 13 (evals) and section 14 (tests).

## 0. Resume text this v1 must make true

> Built an internal employee-support application that answered policy questions with source citations and completed approved tasks such as creating support tickets, checking onboarding progress, and scheduling orientation sessions. Combined a conversational interface with structured request forms, permission-aware retrieval, and authenticated tools.
>
> * Built a React/TypeScript employee-support application using Cloudflare Workers, Workers AI, R2, and AI Search, grounding responses in approximately 100 versioned synthetic policy documents with source citations and document-effective dates.
> * Built six typed MCP tools for employee-service workflows, enforcing server-side authorization through Cloudflare Access, validated inputs, user-scoped data access, and approval checkpoints for information-changing actions.
> * Built an evaluation harness covering approximately 200 policy questions and action requests, including ambiguous questions, outdated documents, and unauthorized requests, targeting 90% correct, source-grounded answers while tracking latency and cost through AI Gateway.

Exact numbers this repo commits to (single source of truth: `src/shared/synth/counts.ts`, asserted by tests):

| Resume phrase | Exact v1 value |
|---|---|
| approximately 100 versioned synthetic policy documents | 100 documents, 155 versions (47 superseded, 100 current, 8 scheduled as of 2026-10-01) |
| six typed MCP tools | 6 tools, each with a strict zod input schema and an output schema |
| approximately 200 policy questions and action requests | 200 eval cases: 70 answerable, 25 outdated-document, 20 ambiguous, 30 unauthorized, 55 action requests |
| targeting 90% correct, source-grounded answers | measured by `npm run eval` as `groundedAnswerAccuracy` (the 95 answerable plus outdated-document cases). `overallPassRate` over all 200 cases is reported next to it with its own definition. The README reports both measured numbers, whatever they are. Which one the resume quotes is a Claims item (section 17) |

## 1. Goals and non-goals

### Goals

1. Policy Q&A grounded in 100 versioned synthetic policy documents stored in R2, with every answer carrying citations that show document id, version, title, section and effective dates. No answer is shown without at least one validated citation.
2. Permission-aware retrieval: an employee never receives passages from documents above their clearance, and never receives superseded or not-yet-effective versions, regardless of what the retriever returns.
3. Six typed MCP tools served over the MCP Streamable HTTP endpoint (`/mcp`) and used in-process by the chat agent through a real MCP client, so the UI and external MCP clients exercise the same validation and authorization path.
4. Approval checkpoints: the two information-changing tools never write. They create a pending action that only the requesting human can approve through an authenticated HTTP call from the UI. "Human" is enforced: approval requires a verified Access user identity (`identity.kind === "user"`), so an Access service token can propose, read and reject but never approve. No tool, prompt, or model output can approve.
5. Server-side authorization from Cloudflare Access identity: the Worker verifies the Access JWT itself (signature, issuer, audience, expiry) and maps it to an employee record and role in D1.
6. A conversational interface plus structured request forms (new ticket, schedule orientation) that share zod schemas with the server.
7. An evaluation harness with exactly 200 cases that measures correctness, grounding, safety invariants, latency and cost, and writes machine-generated results that the README quotes verbatim.
8. Everything runs and passes tests offline on this Mac (workerd through the Cloudflare Vite plugin, wrangler for local D1 commands, and the Workers Vitest integration). Production services are wired behind interfaces and validated by `wrangler deploy --dry-run`.

### Non-goals (v1)

- Real HR system integrations (Workday, ServiceNow, Google Calendar). Tickets and bookings live in D1.
- Multi-step agent planning. v1 executes at most one tool call per chat turn (plus the retrieval call for policy questions).
- Token streaming. A turn returns one JSON `TurnResult`; the UI shows a progress state.
- WebSocket state sync (`useAgent`). The Agent is reached over Worker RPC only.
- OAuth for third-party MCP clients (Access MCP portals, workers-oauth-provider). External MCP access in v1 requires an Access identity JWT or a mapped Access service token.
- Cloudflare Workflows and Queues. Not needed: approvals are a D1 state machine, and seeding is a script.
- Email or chat notifications.
- Multi-tenancy, i18n.
- An LLM-as-judge. Grading is deterministic.

### Build priority (P0 and P1)

This is one of four v1 projects, so the build session ships P0 completely before touching P1. Every resume claim is covered by P0. P1 items are listed so they are not silently dropped. Each P1 item is marked "(P1)" where it appears later in this spec.

| P0 (must ship in v1) | P1 (deferred, only after P0 is green and the first local eval is recorded) |
|---|---|
| Synthetic generator: archetype-based corpus, org, 200 eval cases, `seedStatements()` and `seed.sql`, exact-count tests | `HomePage` counts and quick-action tiles (the v1 `/` route redirects to `/chat`) |
| D1 migrations, local seeding, reset | Manager onboarding view on `OnboardingPage` and `GET /api/team` polish (P0 keeps a minimal `/api/team` that `OrientationForm` needs) |
| Auth: JWT verifier (local JWKS and remote JWKS), principal resolution, dev issuer and `/dev/login` | Dark theme (P0 ships one light theme on CSS variables) |
| Authz matrix | The R2 S3 API fallback in `seed-remote` |
| Retrievers (D1 FTS5 and AI Search adapter) with PermissionGate | `link-identity` polish (P0 ships the flags in section 18 and nothing else) |
| The 6 MCP tools, `/mcp` route, in-process client | Web tests beyond `ChatPage`, `ApprovalCard` and `TicketForm` |
| ActionService with the single-batch approval (section 6) | `TicketsPage` status filter, `PolicyDocumentPage` diff view, `EmptyState` illustrations |
| LLM providers: Workers AI adapter, OpenAI-compatible, stub, adversarial stub; both AI Gateway log readers (section 11) | |
| ConversationAgent and orchestrator | |
| Eval runner, scorer, report, `update-readme`, in-pool smoke | |
| Minimal UI: chat with citation chips, source drawer and ApprovalCard; TicketForm; OrientationForm; policy list and viewer with VersionTimeline; ActionsPage; TicketsPage (unfiltered); OnboardingPage (self only) | |
| CI, README, `deploy:check` | |

## 2. Architecture

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

### Chat turn (policy question)

```mermaid
sequenceDiagram
  participant B as Browser
  participant W as Worker (Hono)
  participant A as ConversationAgent (DO)
  participant M as MCP server (in-process)
  participant R as Retriever + PermissionGate
  participant L as LlmProvider
  B->>W: POST /api/conversations/:id/messages {text}
  W->>W: verify Access JWT, load Principal, check conversation owner
  W->>A: sendMessage({principal, text, asOf}) via RPC
  A->>L: router call (JSON schema), sees no document text
  L-->>A: {intent: "policy_question", search_query}
  A->>M: callTool search_policies {query} (authInfo = principal)
  M->>R: search(query, clearance, asOf, topK)
  R-->>M: permitted, effective passages only
  M-->>A: structuredContent.passages
  A->>L: composer call with passages P1..Pn (JSON schema)
  L-->>A: {kind: "answer", answer, citations: ["P2"]}
  A->>A: CitationValidator maps P2 to passage, checks it was returned this turn
  A-->>W: TurnResult {kind, text, citations[effective dates], trace}
  W-->>B: 200 TurnResult
```

### Information-changing action with approval checkpoint

```mermaid
sequenceDiagram
  participant B as Browser
  participant W as Worker
  participant A as ConversationAgent
  participant M as MCP server
  participant S as ActionService (D1)
  B->>W: "Open an IT ticket, my laptop will not boot"
  W->>A: sendMessage
  A->>M: callTool create_support_ticket {category:"it", ...}
  M->>S: propose(): validate, authorize, insert pending_actions (awaiting_approval)
  S-->>M: {status:"approval_required", actionId, expiresAt, preview}
  M-->>A: tool result (no ticket row exists yet)
  A-->>B: TurnResult kind="approval_required" with ApprovalCard
  B->>W: POST /api/actions/:id/approve (same human user identity, same-origin)
  W->>S: approve(): digest check, re-authorize, then ONE D1 batch: claim + execute + finalize + audit
  S-->>W: {status:"executed", result:{ticketId:"TKT-000151"}}
  W->>A: recordActionOutcome (RPC)
  W-->>B: 200
```

Key security properties, each enforced by code and tested:

1. Identity comes only from a verified RS256 JWT (Access in production, a local issuer in dev and tests) mapped to a D1 employee. Request bodies never carry identity.
2. The router LLM call happens before any document text is seen, and the composer has no tool path. Retrieved content therefore cannot trigger tool calls (prompt injection through documents cannot cause actions).
3. Approval requires an HTTP POST from the requesting principal, and that principal must be an Access user identity, not a service token. `requireSameOrigin` is CSRF protection only and is not treated as proof of a human. Typing "approve" in chat is answered with an instruction to use the button and executes nothing.
4. Authorization is re-checked at approval time, against current D1 state.
5. For policy questions, "not found" and "not permitted" produce the same refusal text, so the existence of restricted documents is not revealed. The document API returns 404 (not 403) for documents above the caller's clearance. Retriever failures are never folded into that refusal: they produce `kind: "error"` (section 7), so a broken index cannot masquerade as a correct refusal.
6. Test-only LLM providers (`stub`, `adversarial-stub`) are rejected by `parseConfig` when `AUTH_MODE=access`, so they cannot ship to production. No request header or query parameter can select a provider or auth mode.

## 3. Version pins (verified on this Mac, 2026-10-08)

| Package | Pin | Notes |
|---|---|---|
| node | 25.9.0 (`.nvmrc`) | Runs `scripts/*.ts` and `evals/*.ts` natively (type stripping), checked |
| hono | 4.13.13 | |
| @hono/zod-validator | 0.9.1 | peers: zod ^3.25 or ^4, hono >=4.11.2 |
| zod | 4.6.5 | |
| jose | 6.2.12 | |
| agents | 0.27.0 | peers require `@modelcontextprotocol/sdk` exactly 1.30.0 and `@modelcontextprotocol/server` + `@modelcontextprotocol/client` exactly 2.0.0 (non-optional) |
| @modelcontextprotocol/server | 2.0.0 | imported directly; must stay at 2.0.0 while agents 0.27.0 pins it (latest is 2.3.1) |
| @modelcontextprotocol/client | 2.0.0 | same |
| @modelcontextprotocol/sdk | 1.30.0 | peer of agents only; not imported |
| react, react-dom | 19.3.0 | |
| react-router | 8.4.0 | `createBrowserRouter` + `RouterProvider`, checked |
| wrangler | 4.149.0 | dev dependency, not global (no global wrangler on this Mac) |
| vite | 8.3.4 | agents peer allows vite <9 |
| @cloudflare/vite-plugin | 1.63.1 | peers vite ^6 or ^7 or ^8, wrangler ^4.149.0 |
| @vitejs/plugin-react | 6.1.2 | |
| vitest | 4.1.11 | not 5.x |
| @cloudflare/vitest-plugin | 1.3.7 exactly (no caret) | the renamed `@cloudflare/vitest-pool-workers` (see note). Install only this package, not both |
| typescript | 7.0.2 | npm `latest`; typechecked the spike's Worker code (agents, MCP v2, Hono, jose) with no errors. It ships no JS API (`require("typescript")` fails), so no script, test or config may import it programmatically; only the `tsc` CLI is used. Fallback 6.0.3 if any tool breaks |
| @types/react, @types/react-dom | 19.3.0 | |
| @types/node | 25.9.9 | scripts and evals only |
| happy-dom | 20.14.5 | web component tests |
| @testing-library/react, @testing-library/dom | 16.3.3, 10.4.2 | |
| GitHub Actions | actions/checkout v7, actions/setup-node v7 | latest tags v7.0.1 and v7.1.0 per `gh api` |

Note on the test pool: `npm view @cloudflare/vitest-pool-workers deprecated` returns "has been renamed to @cloudflare/vitest-plugin. This package will not receive future updates", and 0.23.0 still bundles wrangler 4.124.0 and an August miniflare. The current Cloudflare docs (Vitest integration configuration page) import `cloudflareTest` and `readD1Migrations` from `@cloudflare/vitest-plugin`. The exported API (`cloudflareTest`, `readD1Migrations`, the `cloudflare:test` module) is the same in both packages; I diffed the type files. v1 uses `@cloudflare/vitest-plugin@1.3.7` with vitest 4.1.11. If the orchestrator insists on the old name, swapping the import path is the only change. The README calls it "the Workers Vitest integration (`@cloudflare/vitest-plugin`, the renamed `@cloudflare/vitest-pool-workers`)", because the project standard names the old package.

The test runtime is not wrangler 4.149.0. `@cloudflare/vitest-plugin@1.3.7` pins and nests its own `wrangler@4.148.0` and `miniflare@5.20261006.0-alpha` (checked in `node_modules/@cloudflare/vitest-plugin/package.json` and its nested `node_modules`). Dev and build use the top-level wrangler 4.149.0. Version 1.4.0 was published 2026-10-08 18:27 UTC (nests wrangler 4.149.0, peer vitest `^4.1.0 || ^5.0.0`); it is too new to adopt, so the pin stays at 1.3.7 until 1.4.x has been out for two weeks.

Note on runtime types: `wrangler types` in 4.149.0 prints that generated runtime types supersede `@cloudflare/workers-types`. v1 commits `worker-configuration.d.ts` generated by `wrangler types --strict-vars false` and does not depend on `@cloudflare/workers-types`. (Its 5.20261008.1 type file was still used to research the AI Search and AI Gateway APIs below.)

`compatibility_date`: `2026-10-01`, `compatibility_flags: ["nodejs_compat"]` (the agents MCP handler uses AsyncLocalStorage for auth context).

## 4. Exact file tree

Everything below is created in the build phase. `data/generated/asof-2026-10-01/` and `evals/dataset/asof-2026-10-01/` are generated by `npm run generate` and committed so reviewers can read the corpus; CI regenerates them and fails on any diff. A production dataset for another business date is written next to it as `asof-<date>/` (section 12).

```
peopledesk/
├── .github/
│   └── workflows/
│       └── ci.yml
├── .gitignore                      # node_modules, dist, .wrangler, .dev.vars*, .env*, evals/results/*/raw
├── .gitattributes                  # * text=auto eol=lf (generated files must hash the same on every OS)
├── .nvmrc                          # 25.9.0
├── .dev.vars.example               # documents every local var; real .dev.vars is gitignored
├── LICENSE                         # MIT
├── README.md
├── SPEC.md
├── package.json
├── package-lock.json
├── index.html                      # SPA entry, loads /src/web/main.tsx
├── vite.config.ts                  # react() + cloudflare()
├── vitest.config.ts                # five projects: worker, worker-access, worker-adversarial (workerd), node, web (happy-dom)
├── wrangler.jsonc                  # default env = local; env.production = Cloudflare
├── worker-configuration.d.ts       # generated by `wrangler types --strict-vars false`, committed
├── tsconfig.base.json              # strict, noUncheckedIndexedAccess, verbatimModuleSyntax,
│                                   # allowImportingTsExtensions, erasableSyntaxOnly, noEmit
├── tsconfig.worker.json            # src/worker, src/shared, evals/lib (runner and scorer also run in workerd),
│                                   # test/worker*, test/helpers, test/types.d.ts
├── tsconfig.web.json               # src/web, src/shared, test/web (DOM lib, react-jsx)
├── tsconfig.node.json              # scripts, evals, test/node, vite/vitest configs
├── migrations/
│   ├── 0001_core.sql
│   ├── 0002_policies.sql
│   ├── 0003_services.sql
│   └── 0004_actions.sql
├── src/
│   ├── shared/                     # isomorphic: no Node, no Workers, no DOM APIs
│   │   ├── domain.ts               # Role, Clearance, Region, ids, enums, ToolName
│   │   ├── api-types.ts            # zod schemas for every HTTP request and response
│   │   ├── tool-schemas.ts         # zod input + output schemas for the 6 MCP tools
│   │   ├── dates.ts                # isEffective(), versionStatusAt(), date-only helpers
│   │   ├── canonical-json.ts       # stable stringify used for the action arguments digest (integrity only)
│   │   └── synth/
│   │       ├── counts.ts           # EXPECTED_COUNTS (resume numbers + derived counts)
│   │       ├── prng.ts             # sfc32 seeded from a string (cyrb128 hash)
│   │       ├── names.ts            # first/last name pools, departments, titles
│   │       ├── dates.ts            # UTC-only date math: addMonths, firstOfMonth, addDays (no Intl, no locale)
│   │       ├── archetypes.ts       # 9 fact archetypes: unit, value bands per clearance, sentence + question templates
│   │       ├── blueprints.ts       # 100 compact rows: title, category, audience, 2-3 (archetype, subject) pairs
│   │       ├── ambiguity-groups.ts # the 6 hand-written ambiguity groups
│   │       ├── corpus.ts           # versions, facts, month-offset effective dates, restricted-value disjointness
│   │       ├── render-markdown.ts  # PolicyVersion -> markdown with front matter
│   │       ├── chunk.ts            # markdown -> section chunks (shared by seed + tests)
│   │       ├── org.ts              # employees, onboarding, sessions, bookings, tickets, personas
│   │       ├── eval-cases.ts       # the 200 eval cases, derived from corpus + org
│   │       └── seed-sql.ts         # seedStatements(): Array<{ sql, params }>; renderSeedSql() for wrangler
│   ├── worker/
│   │   ├── index.ts                # export default { fetch } and export { ConversationAgent }
│   │   ├── app.ts                  # Hono app wiring, error envelope, request ids
│   │   ├── config-keys.ts          # CONFIG_KEYS: the closed list of vars parseConfig reads (tests pin all of them)
│   │   ├── env.ts                  # parseConfig(env): zod-validated runtime config, reads CONFIG_KEYS only
│   │   ├── container.ts            # builds per-request services from config + bindings
│   │   ├── clock.ts                # SystemClock, FixedClock (AS_OF_OVERRIDE, dev only)
│   │   ├── auth/
│   │   │   ├── identity.ts         # JwtIdentityVerifier (jose), key sources: remote JWKS / local JWKS
│   │   │   ├── principal.ts        # resolvePrincipal(): email or service-token common_name -> Principal
│   │   │   ├── middleware.ts       # requireAuth, requireSameOrigin, dev-mode host guard
│   │   │   └── dev-routes.ts       # /dev/login, /dev/personas, /dev/token (dev only)
│   │   ├── authz/
│   │   │   └── policy.ts           # can(principal, capability, resource): pure, table-tested
│   │   ├── policies/
│   │   │   ├── store.ts            # PolicyStore: D1 metadata + R2 bodies + version history
│   │   │   ├── retriever.ts        # PolicyRetriever interface + RetrievedPassage type
│   │   │   ├── retriever-d1-fts.ts # local: FTS5 + bm25 with clearance and effective-date SQL filters
│   │   │   ├── retriever-ai-search.ts # production: AiSearchInstance.search with metadata filters, return_on_failure false
│   │   │   ├── chunk-align.ts      # maps an AI Search chunk to the D1 chunk of the same version (section, passageId)
│   │   │   ├── fts-query.ts        # sanitizer: user text -> safe FTS5 MATCH expression
│   │   │   └── permission-gate.ts  # re-checks every passage against D1 (clearance, effective at asOf)
│   │   ├── services/
│   │   │   ├── employees.ts
│   │   │   ├── tickets.ts
│   │   │   ├── onboarding.ts
│   │   │   ├── orientation.ts
│   │   │   ├── actions.ts          # propose / approve / reject / list; execution handlers
│   │   │   └── audit.ts
│   │   ├── mcp/
│   │   │   ├── server.ts           # buildMcpServer(principal, services): McpServer with 6 tools; cheap per request
│   │   │   ├── tool-defs.ts        # module-scope cache: tool metadata and JSON Schemas computed once per isolate
│   │   │   ├── errors.ts           # ToolError -> { isError, content, structuredContent.error }
│   │   │   ├── tools/
│   │   │   │   ├── search-policies.ts
│   │   │   │   ├── create-support-ticket.ts
│   │   │   │   ├── list-my-tickets.ts
│   │   │   │   ├── get-onboarding-progress.ts
│   │   │   │   ├── list-orientation-sessions.ts
│   │   │   │   └── schedule-orientation-session.ts
│   │   │   ├── route.ts            # ALL /mcp: requireAuth then createMcpHandler(...).fetch(req, {authInfo})
│   │   │   └── in-process-client.ts # MCP Client over StreamableHTTPClientTransport with injected fetch
│   │   ├── llm/
│   │   │   ├── provider.ts         # LlmProvider interface, LlmResult, JsonSchema type
│   │   │   ├── workers-ai.ts       # env.AI.run(..., { gateway }) + aiGatewayLogId (hint only)
│   │   │   ├── openai-compatible.ts # llama-server or any /v1/chat/completions endpoint
│   │   │   ├── stub.ts             # deterministic rule-based router + composer (tests)
│   │   │   ├── adversarial-stub.ts # tries forbidden things on purpose (safety tests)
│   │   │   ├── pricing.ts          # Workers AI list prices used for labeled estimates
│   │   │   └── gateway-log.ts      # BindingGatewayLogReader (env.AI.gateway(id).getLog), production only
│   │   ├── chat/
│   │   │   ├── agent.ts            # ConversationAgent extends Agent (no Agent state; SQLite only)
│   │   │   ├── turn-lock.ts        # TurnLock: one turn per conversation, released in finally, 60 s ceiling
│   │   │   ├── people.ts           # permitted directory slice + deterministic person-name resolution
│   │   │   ├── orchestrator.ts     # runTurn(): router -> tool or retrieval -> composer -> validate
│   │   │   ├── prompts.ts          # system prompts + router/composer JSON schemas
│   │   │   ├── citations.ts        # CitationValidator + fact-in-passage check helpers
│   │   │   └── render.ts           # deterministic texts for tool results, refusals, approvals
│   │   └── routes/
│   │       ├── health.ts
│   │       ├── me.ts
│   │       ├── conversations.ts
│   │       ├── policies.ts
│   │       ├── tickets.ts
│   │       ├── onboarding.ts
│   │       ├── orientation.ts
│   │       ├── team.ts             # minimal in P0 (OrientationForm needs it); polish is P1
│   │       └── actions.ts
│   └── web/
│       ├── main.tsx
│       ├── router.tsx
│       ├── styles.css              # CSS variables, light theme (dark theme is P1)
│       ├── lib/
│       │   ├── api.ts              # typed fetch wrapper, parses error envelope with shared zod
│       │   ├── format.ts           # dates, relative expiry, money
│       │   └── markdown.tsx        # restricted markdown -> React elements (no innerHTML)
│       ├── components/
│       │   ├── AppShell.tsx
│       │   ├── UserBadge.tsx
│       │   ├── ConversationList.tsx
│       │   ├── MessageList.tsx
│       │   ├── ChatComposer.tsx
│       │   ├── CitationChip.tsx
│       │   ├── SourceDrawer.tsx
│       │   ├── EffectiveDateBadge.tsx
│       │   ├── ApprovalCard.tsx
│       │   ├── ToolResultCard.tsx  # TicketTable, OnboardingChecklist, SessionTable variants
│       │   ├── TicketForm.tsx
│       │   ├── OrientationForm.tsx
│       │   ├── VersionTimeline.tsx
│       │   ├── ErrorBanner.tsx
│       │   └── EmptyState.tsx
│       └── pages/
│           ├── HomePage.tsx            # P1; in P0 the "/" route redirects to /chat
│           ├── ChatPage.tsx
│           ├── PoliciesPage.tsx
│           ├── PolicyDocumentPage.tsx
│           ├── NewTicketPage.tsx
│           ├── ScheduleOrientationPage.tsx
│           ├── TicketsPage.tsx
│           ├── OnboardingPage.tsx
│           ├── ActionsPage.tsx
│           └── NotFoundPage.tsx
├── scripts/
│   ├── generate.ts                 # --as-of YYYY-MM-DD (default 2026-10-01): writes data/generated/asof-<date>/**
│   │                               # and evals/dataset/asof-<date>/cases.jsonl
│   ├── dev-keys.ts                 # RS256 key pair -> .dev.vars (DEV_ACCESS_JWKS, DEV_ACCESS_PRIVATE_JWK);
│   │                               # optional --llm-provider writes LLM_PROVIDER (tests are immune, section 14)
│   ├── seed-local.ts               # d1 migrations --local, d1 execute seed.sql --local, R2 via getPlatformProxy
│   ├── reset-local.ts              # deletes .wrangler/state/v3/{d1,r2,do} for this project, then seeds
│   ├── seed-remote.ts              # production seeding (needs wrangler login), see section 18
│   ├── link-identity.ts            # inserts identity_links rows (real Access email or service token)
│   ├── verify-ai-search.ts         # production: sync, wait for indexing, then filter and non-empty checks
│   ├── verify-gateway.ts           # production: one call, then confirm a log with tokens and cost is readable
│   └── llm-serve.ts                # starts llama-server with the pinned flags
├── data/
│   └── generated/
│       └── asof-2026-10-01/        # committed default dataset; other asof-<date>/ dirs for production
│           ├── manifest.json       # docs, versions, facts, chunk ids, sha256, asOf, validFrom, validUntil, datasetSha256
│           ├── org.json            # employees, onboarding, sessions, bookings, tickets, personas
│           ├── seed.sql            # rendered from seedStatements(); one statement per line, newlines as char(10)
│           └── policies/
│               ├── r1-all/POL-001/v01.md ... (155 files across r1-all, r2-managers, r3-hr)
│               ├── r2-managers/...
│               └── r3-hr/...
├── evals/
│   ├── dataset/
│   │   └── asof-2026-10-01/cases.jsonl   # exactly 200 cases
│   ├── lib/
│   │   ├── runner.ts               # platform-agnostic: takes a fetch function; sends Origin + Content-Type
│   │   ├── scorer.ts               # deterministic grading per case type
│   │   ├── normalize.ts            # numbers, money, durations, number words
│   │   ├── leak.ts                 # normalized restricted-value scan over text, quotes and toolResult only
│   │   ├── stats.ts                # Wilson interval, percentiles
│   │   ├── report.ts               # summary.json + summary.md
│   │   └── gateway.ts              # production: AI Gateway logs via REST list (search by turnId) or the Worker route
│   ├── run.ts                      # CLI: npm run eval -- --base-url ... --run-id ...
│   ├── update-readme.ts            # writes README Results block from a summary.json
│   └── results/
│       └── <runId>/{results.jsonl, summary.json, summary.md}
└── test/
    ├── types.d.ts                  # declare namespace Cloudflare { interface Env { TEST_MIGRATIONS: D1Migration[];
    │                               #   TEST_ACCESS_PRIVATE_JWK: string } } (test-only bindings)
    ├── pool-vars.ts                # BASE_TEST_VARS satisfies Record<ConfigKey, string>; imported by vitest.config.ts
    ├── helpers/
    │   ├── tokens.ts               # mint Access-shaped RS256 JWTs with the test key
    │   ├── http.ts                 # authed SELF.fetch helpers, zod response assertions
    │   └── fixtures.ts             # persona lookups from org.json
    ├── worker-setup.ts             # shared setup: applyD1Migrations, seedStatements() via DB.batch, R2 objects
    ├── worker/                     # AUTH_MODE=dev, LLM_PROVIDER=stub (section 14)
    │   └── *.test.ts
    ├── worker-access/              # AUTH_MODE=access, remote JWKS served by outboundService
    │   └── *.test.ts
    ├── worker-adversarial/         # LLM_PROVIDER=adversarial-stub
    │   └── *.test.ts
    ├── node/
    │   └── *.test.ts
    └── web/
        └── *.test.tsx
```

## 5. Configuration and bindings

### wrangler.jsonc (shape)

The default (top-level) environment is the local one and contains no account-only bindings, so `vite dev`, `vite preview`, `getPlatformProxy` and the test pool never try to reach Cloudflare. `env.production` redeclares every non-inheritable key. `wrangler dev` is not a supported local runtime: with this config it fails because `assets` has no `directory` (only the Vite plugin injects it), and adding one would duplicate what the plugin manages.

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "peopledesk",
  "main": "./src/worker/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/mcp", "/dev/*"]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "peopledesk", "database_id": "00000000-0000-0000-0000-000000000000", "migrations_dir": "migrations" }
  ],
  "r2_buckets": [{ "binding": "POLICY_BUCKET", "bucket_name": "peopledesk-policies" }],
  "durable_objects": { "bindings": [{ "name": "CONVERSATION_AGENT", "class_name": "ConversationAgent" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ConversationAgent"] }],
  "vars": {
    "AUTH_MODE": "dev",
    "DEV_ACCESS_ISSUER": "https://dev-access.peopledesk.test",
    "DEV_ACCESS_AUD": "peopledesk-local",
    "DEV_ACCESS_JWKS": "",
    "DEV_ACCESS_PRIVATE_JWK": "",
    "LLM_PROVIDER": "stub",
    "LLM_BASE_URL": "http://127.0.0.1:8080/v1",
    "LLM_MODEL": "qwen3-1.7b-q4_0",
    "RETRIEVER": "d1-fts",
    "AS_OF_OVERRIDE": "2026-10-01",
    "APP_HOSTNAME": "localhost",
    "ACTION_TTL_SECONDS": "900",
    "ALLOW_SERVICE_TOKENS": "false"
  },
  "env": {
    "production": {
      "assets": { "not_found_handling": "single-page-application", "run_worker_first": ["/api/*", "/mcp"] },
      "d1_databases": [{ "binding": "DB", "database_name": "peopledesk", "database_id": "<set after wrangler d1 create>", "migrations_dir": "migrations" }],
      "r2_buckets": [{ "binding": "POLICY_BUCKET", "bucket_name": "peopledesk-policies" }],
      "durable_objects": { "bindings": [{ "name": "CONVERSATION_AGENT", "class_name": "ConversationAgent" }] },
      "ai": { "binding": "AI" },
      "ai_search": [{ "binding": "POLICY_SEARCH", "instance_name": "peopledesk-policies" }],
      "vars": {
        "AUTH_MODE": "access",
        "ACCESS_TEAM_DOMAIN": "https://<team>.cloudflareaccess.com",
        "ACCESS_AUD": "<Access application AUD tag>",
        "LLM_PROVIDER": "workers-ai",
        "WORKERS_AI_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        "AI_GATEWAY_ID": "peopledesk",
        "RETRIEVER": "ai-search",
        "APP_HOSTNAME": "<production hostname>",
        "ACTION_TTL_SECONDS": "900",
        "ALLOW_SERVICE_TOKENS": "false"   // true only during an eval window: npm run deploy:eval-window (section 18)
      }
    }
  }
}
```

Verified behavior of this shape (spike): `wrangler types` emits a base `Env` where `AI?: Ai` and `POLICY_SEARCH?: AiSearchInstance` are optional plus a `Cloudflare.ProductionEnv` where they are required; `CLOUDFLARE_ENV=production vite build` followed by `wrangler deploy --dry-run` runs offline and lists the bindings `CONVERSATION_AGENT` (Durable Object), `DB` (D1), `POLICY_SEARCH` (AI Search Instance), `POLICY_BUCKET` (R2), `AI` (AI). CI runs exactly this as `npm run deploy:check`.

`.dev.vars` (gitignored, created by `npm run dev:keys`, documented in `.dev.vars.example`) overrides `DEV_ACCESS_JWKS` and `DEV_ACCESS_PRIVATE_JWK` with a fresh local key pair, and sets `LLM_PROVIDER` (`stub` by default, `openai-compatible` with `--llm-provider openai-compatible` when llama-server is running). Worker vars come from wrangler config and `.dev.vars`, not from the shell, so provider switching for `npm run dev` and `npm run preview` always goes through `.dev.vars`.

`.dev.vars` also reaches the test pool. Verified twice (the reviewer's spike and my own probe at `scratchpad/pd-verify`): with `.dev.vars` containing `LLM_PROVIDER=openai-compatible` and `AUTH_MODE=access`, the pool printed "Using secrets defined in .dev.vars" and the Worker saw both values. The bundled wrangler's `getVarsForDev` loads `.dev.vars` (or `.dev.vars.<env>` falling back to `.dev.vars`, or `.env` files when no `.dev.vars` exists) whenever no `envFiles` are passed, and the plugin exposes no `envFiles` option. Values set in `miniflare.bindings` override it (verified: `LLM_PROVIDER` came back `stub`), but a key that is only in `.dev.vars` still leaks through (verified with an extra key). Two rules follow, both enforced in section 14:

1. `parseConfig` reads only the keys in `src/worker/config-keys.ts` (`CONFIG_KEYS`). Any other env key is ignored.
2. Every Vitest workerd project sets `miniflare.bindings` for every key in `CONFIG_KEYS` from `test/pool-vars.ts`, typed `satisfies Record<ConfigKey, string>`, so adding a config key without pinning it is a type error.

### npm scripts (`package.json`, `"type": "module"`)

| Script | Command |
|---|---|
| `dev` | `vite dev` |
| `build` | `vite build` |
| `preview` | `vite build && vite preview` |
| `typecheck` | `tsc -p tsconfig.worker.json && tsc -p tsconfig.web.json && tsc -p tsconfig.node.json` |
| `test` | `vitest run` |
| `types` | `wrangler types --strict-vars false` |
| `generate` | `node scripts/generate.ts` (accepts `-- --as-of YYYY-MM-DD`) |
| `dev:keys` | `node scripts/dev-keys.ts` |
| `seed:local` | `node scripts/seed-local.ts` |
| `db:reset:local` | `node scripts/reset-local.ts` |
| `llm:serve` | `node scripts/llm-serve.ts` |
| `eval` | `node evals/run.ts` |
| `eval:readme` | `node evals/update-readme.ts` |
| `deploy:check` | `CLOUDFLARE_ENV=production vite build && wrangler deploy --dry-run` |
| `deploy` | `CLOUDFLARE_ENV=production vite build && wrangler deploy` (service tokens off) |
| `deploy:eval-window` | `CLOUDFLARE_ENV=production vite build && wrangler deploy --var ALLOW_SERVICE_TOKENS:true` (`--var` checked in `wrangler deploy --help`, 4.149.0) |
| `seed:remote` | `node scripts/seed-remote.ts` |
| `link-identity` | `node scripts/link-identity.ts` |
| `verify:ai-search` | `node scripts/verify-ai-search.ts` |
| `verify:gateway` | `node scripts/verify-gateway.ts` |

`"type": "module"` is required: the spike's `vitest.config.ts` failed to load `@cloudflare/vitest-plugin` (ESM only) until it was set.

### Runtime config (`src/worker/env.ts`)

`parseConfig(env)` reads only `CONFIG_KEYS`, validates with zod and returns a discriminated config. Invalid config yields HTTP 500 `{ error: { code: "misconfigured", ... } }` on every route (tested). The parsed config and everything derived from it (JWKS key source, provider, retriever) is cached at module scope, keyed by a fingerprint of the `CONFIG_KEYS` values, so steady-state requests do no re-parsing (section 10, CPU budget). Rules:

- `CONFIG_KEYS` = `AUTH_MODE, ACCESS_TEAM_DOMAIN, ACCESS_AUD, DEV_ACCESS_ISSUER, DEV_ACCESS_AUD, DEV_ACCESS_JWKS, DEV_ACCESS_PRIVATE_JWK, LLM_PROVIDER, LLM_BASE_URL, LLM_MODEL, WORKERS_AI_MODEL, AI_GATEWAY_ID, RETRIEVER, AS_OF_OVERRIDE, APP_HOSTNAME, ACTION_TTL_SECONDS, ALLOW_SERVICE_TOKENS`. Bindings (`DB`, `POLICY_BUCKET`, `CONVERSATION_AGENT`, `AI`, `POLICY_SEARCH`) are not vars and are checked for presence only.
- `AUTH_MODE=access` requires `ACCESS_TEAM_DOMAIN` (https URL) and `ACCESS_AUD` (non-empty), and ignores every `DEV_*` var and `AS_OF_OVERRIDE`. It rejects `LLM_PROVIDER=stub` and `LLM_PROVIDER=adversarial-stub` (500 `misconfigured`), so test providers cannot ship.
- `AUTH_MODE=dev` requires `DEV_ACCESS_JWKS` to parse as a JWK set; requests whose URL hostname is not `localhost`, `127.0.0.1` or `[::1]` get 500 `misconfigured_auth_mode`. This makes an accidental production deploy in dev mode fail closed.
- `LLM_PROVIDER=workers-ai` requires the `AI` binding and `AI_GATEWAY_ID`. `RETRIEVER=ai-search` requires `POLICY_SEARCH`.
- `ALLOW_SERVICE_TOKENS=true` enables mapping Access service-token JWTs through `identity_links`. It defaults to `false` everywhere and is turned on only for a production eval window (section 18). Even when on, a service-token principal can never approve (section 9).
- No request header, cookie or query parameter can change the auth mode, provider or retriever.

## 6. D1 schema and migrations

D1 enforces foreign keys. Dates are ISO strings: date-only `YYYY-MM-DD` for business dates, full ISO 8601 UTC for timestamps. Effective ranges are half-open: `[effective_from, effective_to)`, `effective_to` NULL meaning open-ended.

### `migrations/0001_core.sql`

```sql
CREATE TABLE employees (
  id TEXT PRIMARY KEY CHECK (id GLOB 'E[0-9][0-9][0-9][0-9]'),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee','manager','hr_admin')),
  department TEXT NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('US','IN','UK')),
  job_title TEXT NOT NULL,
  manager_id TEXT REFERENCES employees(id),
  start_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE INDEX idx_employees_manager ON employees(manager_id);

-- Real Access users and Access service tokens mapped onto seeded employees (empty in seed).
CREATE TABLE identity_links (
  identity TEXT PRIMARY KEY,                 -- lowercased email, or service token common_name
  kind TEXT NOT NULL CHECK (kind IN ('email','service_token')),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  created_at TEXT NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,                       -- uuid v4
  employee_id TEXT NOT NULL REFERENCES employees(id),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_conversations_owner ON conversations(employee_id, updated_at DESC);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('tool_call','authz_denied','action_proposed','action_approved',
    'action_rejected','action_executed','action_failed','policy_viewed')),
  tool TEXT,
  target TEXT,
  outcome TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, at);

-- Which generated dataset is seeded; read by /api/health and checked by the eval runner.
CREATE TABLE dataset_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  as_of TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  sha256 TEXT NOT NULL
);
```

### `migrations/0002_policies.sql`

```sql
CREATE TABLE policy_documents (
  doc_id TEXT PRIMARY KEY CHECK (doc_id GLOB 'POL-[0-9][0-9][0-9]'),
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('time_off','benefits','compensation','travel_expense',
    'remote_work','it_security','conduct','onboarding_learning','health_safety','performance')),
  audience TEXT NOT NULL CHECK (audience IN ('all','managers','hr')),
  audience_rank INTEGER NOT NULL CHECK (audience_rank IN (1,2,3)),   -- all=1, managers=2, hr=3
  owner_team TEXT NOT NULL
);

CREATE TABLE policy_versions (
  doc_id TEXT NOT NULL REFERENCES policy_documents(doc_id),
  version INTEGER NOT NULL CHECK (version >= 1),
  r2_key TEXT NOT NULL UNIQUE,               -- policies/r<rank>-<audience>/<doc_id>/v<NN>.md
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  change_summary TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  PRIMARY KEY (doc_id, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX idx_versions_effective ON policy_versions(effective_from, effective_to);

CREATE TABLE policy_chunks (
  id INTEGER PRIMARY KEY,                    -- FTS5 external-content rowid
  chunk_id TEXT NOT NULL UNIQUE,             -- 'POL-014@3#2'
  doc_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  section TEXT NOT NULL,
  text TEXT NOT NULL,
  FOREIGN KEY (doc_id, version) REFERENCES policy_versions(doc_id, version)
);

CREATE VIRTUAL TABLE policy_chunks_fts USING fts5(
  title, section, text,
  content='policy_chunks', content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2'
);
CREATE TRIGGER policy_chunks_ai AFTER INSERT ON policy_chunks BEGIN
  INSERT INTO policy_chunks_fts(rowid, title, section, text) VALUES (new.id, new.title, new.section, new.text);
END;
CREATE TRIGGER policy_chunks_ad AFTER DELETE ON policy_chunks BEGIN
  INSERT INTO policy_chunks_fts(policy_chunks_fts, rowid, title, section, text)
  VALUES ('delete', old.id, old.title, old.section, old.text);
END;
CREATE TRIGGER policy_chunks_au AFTER UPDATE ON policy_chunks BEGIN
  INSERT INTO policy_chunks_fts(policy_chunks_fts, rowid, title, section, text)
  VALUES ('delete', old.id, old.title, old.section, old.text);
  INSERT INTO policy_chunks_fts(rowid, title, section, text) VALUES (new.id, new.title, new.section, new.text);
END;
```

All 155 versions are chunked and indexed, including superseded and scheduled ones. Filtering happens at query time (that is the mechanism under test).

### `migrations/0003_services.sql`

```sql
CREATE TABLE tickets (
  id TEXT PRIMARY KEY CHECK (id GLOB 'TKT-[0-9][0-9][0-9][0-9][0-9][0-9]'),
  requester_id TEXT NOT NULL REFERENCES employees(id),
  category TEXT NOT NULL CHECK (category IN ('it','payroll','benefits','facilities','hr_general','access_request')),
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low','normal','high')),
  status TEXT NOT NULL CHECK (status IN ('open','in_progress','resolved','closed')),
  related_policy_id TEXT REFERENCES policy_documents(doc_id),
  created_via TEXT NOT NULL CHECK (created_via IN ('seed','chat','form','mcp')),
  action_id TEXT UNIQUE,                     -- pending_actions.id that created it (idempotency)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tickets_requester ON tickets(requester_id, status, created_at DESC);

CREATE TABLE onboarding_plans (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id),
  buddy_id TEXT REFERENCES employees(id),
  start_date TEXT NOT NULL,
  target_completion_date TEXT NOT NULL
);

CREATE TABLE onboarding_tasks (
  id TEXT PRIMARY KEY,                       -- 'ONB-E0042-07'
  employee_id TEXT NOT NULL REFERENCES onboarding_plans(employee_id),
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('paperwork','it_setup','training','meet_people','orientation')),
  owner_role TEXT NOT NULL CHECK (owner_role IN ('employee','manager','hr_admin','it')),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','in_progress','done','blocked')),
  completed_at TEXT
);
CREATE INDEX idx_onboarding_tasks_employee ON onboarding_tasks(employee_id, ordinal);

CREATE TABLE orientation_sessions (
  id TEXT PRIMARY KEY CHECK (id GLOB 'ORI-[0-9][0-9][0-9]'),
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,                   -- ISO 8601 UTC
  duration_min INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('virtual','in_person')),
  region TEXT NOT NULL CHECK (region IN ('US','IN','UK','GLOBAL')),
  location TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  facilitator_id TEXT NOT NULL REFERENCES employees(id)
);

CREATE TABLE orientation_bookings (
  id TEXT PRIMARY KEY,                       -- 'BKG-<uuid>'
  session_id TEXT NOT NULL REFERENCES orientation_sessions(id),
  employee_id TEXT NOT NULL UNIQUE REFERENCES employees(id),   -- one orientation per employee
  booked_by TEXT NOT NULL REFERENCES employees(id),
  action_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_bookings_session ON orientation_bookings(session_id);
```

### `migrations/0004_actions.sql`

```sql
CREATE TABLE pending_actions (
  id TEXT PRIMARY KEY,                       -- uuid v4
  tool TEXT NOT NULL CHECK (tool IN ('create_support_ticket','schedule_orientation_session')),
  requester_id TEXT NOT NULL REFERENCES employees(id),
  subject_employee_id TEXT NOT NULL REFERENCES employees(id),  -- who the action affects
  conversation_id TEXT REFERENCES conversations(id),
  source TEXT NOT NULL CHECK (source IN ('chat','form','mcp')),
  arguments_json TEXT NOT NULL,              -- canonical JSON of validated args
  arguments_sha256 TEXT NOT NULL,            -- integrity check only (see below), not a security control
  preview_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('awaiting_approval','executing','executed','rejected','expired','failed')),
  claim_id TEXT,                             -- uuid of the approve request that claimed the row
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES employees(id),
  result_json TEXT,
  error_code TEXT,
  superseded_by TEXT REFERENCES pending_actions(id)
);
CREATE INDEX idx_actions_requester ON pending_actions(requester_id, status, created_at DESC);
```

Action state machine: `awaiting_approval -> executed | failed` (through `executing`, which exists only inside the approval transaction), `awaiting_approval -> rejected`, and `awaiting_approval` past `expires_at` is reported as `expired` (and written as such on any touch).

`arguments_sha256` sits in the same row as `arguments_json`, so it proves integrity (no serialization drift or partial write between propose and approve), not tamper resistance: anyone who can write the row can rewrite both. The README and code comments describe it that way and never as a security control.

#### Propose (atomic rate limit)

One conditional insert, so two concurrent proposals cannot both pass a check-then-insert:

```sql
INSERT INTO pending_actions (id, tool, requester_id, subject_employee_id, conversation_id, source,
                             arguments_json, arguments_sha256, preview_json, status, created_at, expires_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'awaiting_approval', ?10, ?11
WHERE (SELECT COUNT(*) FROM pending_actions
       WHERE requester_id = ?3 AND status = 'awaiting_approval' AND expires_at > ?10) < 5;
```

`meta.changes === 0` maps to `rate_limited`. Only non-expired rows count.

#### Approve (one transaction: claim, execute, finalize, audit)

`approve(principal, actionId)` first does the read-only checks in JS: the row exists and `requester_id` is the caller (else 404); the identity is a user, not a service token (else 403 `human_approval_required`); the digest of `arguments_json` matches `arguments_sha256`; zod re-parse; `can()` with the principal reloaded from D1. Then it sends ONE `DB.batch` (a single D1 transaction) with a fresh `claim_id`. Every statement after the claim is gated on `claim_id`, so a losing concurrent approver's batch changes nothing. This exact SQL shape ran in local D1 in my probe (`scratchpad/pd-verify/test/approve.test.ts`), covering success, double approve, `session_full`, `already_booked` and expired:

```sql
-- 1. claim
UPDATE pending_actions SET status='executing', claim_id=?cid, decided_at=?now, decided_by=?me
 WHERE id=?aid AND requester_id=?me AND status='awaiting_approval' AND expires_at > ?now;
-- 2. execute (booking shown; a ticket uses INSERT ... SELECT (SELECT printf('TKT-%06d', COALESCE(MAX(CAST(substr(id,5) AS INTEGER)),0)+1) FROM tickets), ...
--    WHERE <claimed>; the aggregate sits in a scalar subquery so the claim gate can filter the single row)
INSERT INTO orientation_bookings (id, session_id, employee_id, booked_by, action_id, created_at)
SELECT 'BKG-' || ?aid, ?sid, ?emp, ?me, ?aid, ?now
 WHERE EXISTS (SELECT 1 FROM pending_actions WHERE id=?aid AND claim_id=?cid AND status='executing')
   AND NOT EXISTS (SELECT 1 FROM orientation_bookings WHERE employee_id=?emp)
   AND (SELECT COUNT(*) FROM orientation_bookings WHERE session_id=?sid)
       < (SELECT capacity FROM orientation_sessions WHERE id=?sid);
-- 3. finalize, conditioned on what step 2 actually wrote
UPDATE pending_actions SET
   status     = CASE WHEN EXISTS (SELECT 1 FROM orientation_bookings WHERE action_id=?aid) THEN 'executed' ELSE 'failed' END,
   error_code = CASE WHEN EXISTS (SELECT 1 FROM orientation_bookings WHERE action_id=?aid) THEN NULL
                     WHEN EXISTS (SELECT 1 FROM orientation_bookings WHERE employee_id=?emp) THEN 'already_booked'
                     ELSE 'session_full' END,
   result_json = CASE WHEN EXISTS (SELECT 1 FROM orientation_bookings WHERE action_id=?aid)
                      THEN json_object('bookingId', (SELECT id FROM orientation_bookings WHERE action_id=?aid), 'sessionId', ?sid) END
 WHERE id=?aid AND claim_id=?cid AND status='executing';
-- 4. audit, written only for the winning claim and labeled by what really happened
INSERT INTO audit_log (at, actor_id, event, tool, target, outcome, detail_json)
SELECT ?now, ?me,
       CASE WHEN EXISTS (SELECT 1 FROM orientation_bookings WHERE action_id=?aid) THEN 'action_executed' ELSE 'action_failed' END,
       'schedule_orientation_session', ?aid,
       (SELECT COALESCE(error_code, 'ok') FROM pending_actions WHERE id=?aid), json_object('claimId', ?cid)
 WHERE EXISTS (SELECT 1 FROM pending_actions WHERE id=?aid AND claim_id=?cid);
```

Consequences:

- Because claim, write, finalize and audit commit together, a crash after commit leaves a fully consistent row (`executed` with its result and audit row). No row is ever left in `executing` after a commit, and an `action_executed` audit row cannot exist without the ticket or booking. `already_booked` is detected by the `NOT EXISTS` guard, so the normal path never trips a constraint. `UNIQUE(employee_id)` and `UNIQUE(action_id)` remain as backstops: if either aborts the batch, nothing was claimed, and a follow-up batch claims and finalizes as `failed` with `already_booked` or `conflict` plus its audit row, gated on a new `claim_id` the same way.
- Response mapping from the batch results: claim `meta.changes === 0` means re-read the row. If it is already `executed` or `failed` and `decided_by` is the caller, return 200 with the stored outcome and `replayed: true` (approve is idempotent for the requester's retries). `rejected` gives 409 `not_pending`, expired gives 410 `expired`.
- Defensive reconciliation: if a row is ever observed in `executing` outside a transaction (it should not be), the reader checks `tickets.action_id` or `orientation_bookings.action_id`. It reports `executed` with the found id when one exists, otherwise `failed` with `stale_execution`, and writes the matching `action_executed` or `action_failed` audit row with `detail_json.reconciled = true`.
- The JS re-authorization runs before the batch, so there is a window of milliseconds in which a role change could land between the check and the write. D1 serializes writes, so the window is small. It is accepted and documented, not hidden.

## 7. Durable Object: `ConversationAgent`

There is exactly one Durable Object class. No Workflows. Reasons for an Agent instead of a stateless route: per-conversation transcript storage in SQLite next to the compute, one-turn-at-a-time semantics per conversation, and Agents SDK idioms (`this.sql`, `getAgentByName`) that were verified to run in the test pool.

```ts
// src/worker/chat/agent.ts
import { Agent } from "agents";

export class ConversationAgent extends Agent<Env> {   // no Agent state: SQLite holds everything
  private ids!: { employeeId: string; conversationId: string };   // set in onStart from this.name
  private readonly lock = new TurnLock({ maxTurnMs: 60_000 });

  onStart(): void;   // parse this.name, CREATE TABLE IF NOT EXISTS pd_messages, pd_turns

  // Worker RPC methods. The Worker passes a Principal it has already verified.
  sendMessage(input: { principal: Principal; text: string; asOf: string; evalRunId?: string;
                       caseId?: string; requestOrigin: string }): Promise<TurnResult>;
  getTranscript(input: { principal: Principal }): Promise<TranscriptMessage[]>;
  getTurnTrace(input: { principal: Principal; turnId: string }): Promise<TurnTrace | null>;
  recordActionOutcome(input: { principal: Principal; actionId: string;
    outcome: { status: "executed" | "rejected" | "failed"; summary: string } }): Promise<void>;
}
```

- Name: `${employeeId}:${conversationId}`, built by the Worker from the verified principal and a UUID path parameter that must already exist in D1 `conversations` with the same `employee_id`. Every RPC method also asserts `principal.employeeId === this.ids.employeeId` (defense in depth).
- No `initialState` and no `setState`. Class-field initializers run before the Agent's name is available, so nothing is derived from `this.name` at construction. `onStart` derives `ids`. `getAgentByName` awaits `__unsafe_ensureInitialized` before returning the stub (checked in `agents/dist/agent-routing.js`, line 181), so `onStart` has run before any RPC method executes. Open actions for the conversation are read from D1 `pending_actions.conversation_id`, not cached in the DO.
- SQLite tables (via `this.sql`): `pd_messages(id INTEGER PRIMARY KEY, turn_id TEXT, role TEXT CHECK(role IN ('user','assistant','system')), kind TEXT, text TEXT, payload_json TEXT, created_at TEXT)` and `pd_turns(turn_id TEXT PRIMARY KEY, trace_json TEXT, created_at TEXT)`.
- `TurnLock` (`turn-lock.ts`): `acquire()` throws `turn_in_progress` (HTTP 409) when a turn is in flight. `release()` runs in `finally` on every path, including provider errors and timeouts. A turn that exceeds 60 s is aborted through an `AbortSignal` passed to every LLM call and retrieval, and returns `kind: "error"` with `error.code = "turn_timeout"`. Workers AI calls also pass `gateway.requestTimeoutMs = 25_000` (a `GatewayOptions` field in workers-types 5.20261008.1) and the OpenAI-compatible provider uses `AbortSignal.timeout(25_000)`.
- `sendMessage` calls `runTurn()` from `orchestrator.ts` with services built from `this.env`; the MCP client is created in-process per turn.
- Verified in the spike: `getAgentByName(env.CONVERSATION_AGENT, "E0001:conv1")` then `stub.sendMessage(...)` over RPC, `this.sql` tagged templates, and `this.name`. `runInDurableObject` is exported by `cloudflare:test` in plugin 1.3.7 (types checked), which the turn-lock test uses.

### Turn orchestration (`runTurn`)

1. Guard: trim, 1 to 2000 chars. If a pending action exists in this conversation and the text matches `^(yes|ok|approve|approved|confirm|go ahead|do it)\b`, return `kind: "clarify"` with "Use the Approve button on the request card to confirm." No model call, nothing executed.
2. Router (LLM call 1, JSON schema). Input: the user text, the previous 4 user messages (earlier assistant replies are reduced to their `kind` and tool name, never their text), the principal profile (id, full name, role, region, manager flag), the principal's permitted directory slice, and for scheduling, a compact table of upcoming orientation sessions (id, date, format, region; at most 24 rows). It never sees document text.

   Permitted directory slice (`people.ts`, built from D1 per turn): `employee` gets an empty list; `manager` gets their direct reports (id, full name, in onboarding, booked); `hr_admin` gets the 30 employees with onboarding plans (id, full name, booked). Nobody else is ever listed, so the router cannot learn about people outside the caller's scope.

   Output:
   ```ts
   type RouterOutput = {
     intent: "policy_question" | "tool_call" | "clarify" | "out_of_scope";
     tool?: "create_support_ticket" | "list_my_tickets" | "get_onboarding_progress"
          | "list_orientation_sessions" | "schedule_orientation_session";
     arguments?: Record<string, unknown>;
     person_name?: string;          // set when the user names someone instead of giving an id
     search_query?: string;
     clarifying_question?: string;
   };
   ```
   Invalid JSON gets one retry with the zod error appended; a second failure becomes `clarify` with a generic question.
3. Person resolution (deterministic, no model): if `person_name` is set, it is matched case-insensitively against the slice (full name, or a first name that is unique in the slice) and becomes `arguments.employeeId`. If it matches the principal, it means self. If it is not in the slice, the turn returns `kind: "refuse"` with the fixed text "I can only look up that information for you and the people you support." The same text is used whether the person does not exist or is not permitted. For `list_my_tickets`, any `person_name` other than the principal is refused the same way, because the tool has no way to name someone else. An explicit `E\d{4}` id given by the user is passed through unchanged, and the tool's server-side authorization decides (section 10).
4. `tool_call`: call the tool through the in-process MCP client. Results:
   - read tool ok: `kind: "tool_result"` with `toolResult` = `structuredContent` and a deterministic sentence from `render.ts` (no second model call, so data is never paraphrased incorrectly).
   - write tool ok: `kind: "approval_required"` with `pendingAction`.
   - `isError` with `validation_error`: `kind: "clarify"` naming the missing or invalid field.
   - `forbidden` or `not_found` for another person's data: `kind: "refuse"` with the fixed text from step 3.
5. `policy_question`: call `search_policies` via MCP with `search_query` (fallback: user text), `topK = 6`. If the retriever throws (AI Search error, D1 error), the turn returns `kind: "error"` with `error.code = "retrieval_unavailable"`, never a refusal. If it returns zero passages: `kind: "refuse"`, text "I couldn't find that in the policies available to you." Otherwise the composer (LLM call 2, JSON schema) receives passages labeled `P1..Pn`, each with doc id, version, title, section, effective dates and text:
   ```ts
   type ComposerOutput = { kind: "answer" | "clarify" | "refuse"; answer: string;
     citations: string[];  /* "P1".."Pn" */ clarifying_question?: string };
   ```
6. CitationValidator: maps `Pk` labels to passages returned in this turn, drops anything else (counted as `invalidCitationsDropped`), dedupes. An `answer` with zero valid citations is downgraded to the refusal text. The final text gets a deterministic source line, for example `Source: Paid Time Off Accrual (POL-014 v3, effective 2026-01-01).`
7. Persist user message, assistant message and trace. Return `TurnResult`.

Router intent to `TurnResult.kind` (complete mapping):

| Router outcome | `TurnResult.kind` |
|---|---|
| `policy_question` | `answer`, `clarify` or `refuse` from the composer; `refuse` on zero passages; `error` on retriever failure |
| `tool_call` | `tool_result`, `approval_required`, `clarify` (validation error) or `refuse` (forbidden, not found, person outside the slice) |
| `clarify` | `clarify` |
| `out_of_scope` | `refuse`, text "I can help with company policies, support tickets, onboarding and orientation sessions." |
| LLM provider error or timeout after its retry | `error` (`provider_unavailable` or `turn_timeout`) |

## 8. HTTP API

All `/api/*` and `/mcp` routes run `requireAuth`. Every non-GET `/api/*` route also runs `requireSameOrigin` (`Origin` must equal the request origin, or `Sec-Fetch-Site: same-origin`; JSON content type required). Bodies are validated with `@hono/zod-validator` using schemas from `src/shared/api-types.ts`. Errors use one envelope:

```ts
type ApiError = { error: { code: "unauthenticated" | "forbidden" | "human_approval_required" | "not_found"
  | "validation_error" | "conflict" | "not_pending" | "expired" | "rate_limited" | "turn_in_progress"
  | "misconfigured" | "misconfigured_auth_mode" | "internal";
  message: string; requestId: string; details?: unknown } };
```

| Method | Path | Auth | Request | Response (200 unless noted) |
|---|---|---|---|---|
| GET | `/api/health` | any principal | none | `{ ok: true, authMode, llmProvider, model, retriever, asOf, version, datasetSha256 }` |
| GET | `/api/me` | any | none | `Me = { employeeId, email, fullName, role, region, department, jobTitle, managerId, startDate, inOnboarding: boolean, directReportIds: string[] }` |
| GET | `/api/conversations` | any | none | `{ conversations: Array<{ id, title, createdAt, updatedAt }> }` (own only) |
| POST | `/api/conversations` | any | `{}` | 201 `{ id }` |
| GET | `/api/conversations/:id` | owner | none | `{ id, title, messages: TranscriptMessage[] }`; 404 if not owner |
| POST | `/api/conversations/:id/messages` | owner | `{ text: string(1..2000) }` | `TurnResult`; 409 `turn_in_progress` |
| GET | `/api/conversations/:id/turns/:turnId/gateway-logs` | owner | none | `{ logs: Array<{ logId, purpose, model, tokensIn?, tokensOut?, durationMs, cost?, cached }> }` read through `env.AI.gateway(id).getLog()`; 404 unless `LLM_PROVIDER=workers-ai`. Used by the eval runner when the REST Logs API is unavailable (section 11) |
| GET | `/api/policies` | any | `?category=&q=` | `{ documents: Array<{ docId, title, category, audience, currentVersion, effectiveFrom, updatedAt }> }` (clearance-filtered, current versions at asOf) |
| GET | `/api/policies/:docId` | clearance | none | `{ docId, title, category, audience, versions: Array<{ version, effectiveFrom, effectiveTo, status: "current" \| "superseded" \| "scheduled", changeSummary }> }`; 404 above clearance |
| GET | `/api/policies/:docId/versions/:version` | clearance | none | `{ meta: VersionMeta, markdown: string, r2Key: string }` (body read from R2; audit `policy_viewed`) |
| GET | `/api/tickets` | any | `?status=` | `{ tickets: Ticket[] }` (own only) |
| GET | `/api/onboarding` | any | none | `OnboardingProgress` for self; 404 if no plan |
| GET | `/api/onboarding/:employeeId` | self, manager of, hr_admin | none | `OnboardingProgress`; 404 otherwise |
| GET | `/api/team` | manager, hr_admin | none | `{ members: Array<{ employeeId, fullName, inOnboarding, booked: boolean }> }` (the same directory slice the router sees: direct reports, or all onboarding hires for hr_admin) |
| GET | `/api/orientation-sessions` | any | `?from=&to=&format=&region=` | `{ sessions: Array<Session & { seatsRemaining: number }> }` |
| POST | `/api/actions` | any | `{ tool: "create_support_ticket" \| "schedule_orientation_session", arguments: unknown, supersedes?: uuid }` | 201 `PendingActionView` (forms path, same `ActionService.propose`) |
| GET | `/api/actions` | any | `?status=` | `{ actions: PendingActionView[] }` (own only) |
| POST | `/api/actions/:id/approve` | requester only, user identity only | `{}` | `{ status: "executed", result, replayed: boolean } \| { status: "failed", errorCode, replayed: boolean }`; a retry on an already decided row by the same requester returns the stored outcome with `replayed: true`; 403 `human_approval_required` for a service-token principal; 404 not mine; 409 `not_pending` (rejected); 410 expired |
| POST | `/api/actions/:id/reject` | requester only (user or service token) | `{ reason?: string(0..200) }` | `{ status: "rejected" }` |
| GET, POST | `/mcp` | any principal | MCP Streamable HTTP (JSON-RPC) | MCP responses; 401 without JWT |
| GET | `/dev/login` | none, dev only | none | HTML persona picker (404 unless `AUTH_MODE=dev`) |
| GET | `/dev/personas` | none, dev only | none | `{ personas: Array<{ key, employeeId, email, role, description }> }` |
| POST | `/dev/token` | none, dev only | `{ email }` | `{ token, expiresAt }` and sets `CF_Authorization` cookie (HttpOnly, SameSite=Strict, Path=/) |

There is no `/dev/stats`. The eval's write-safety counter is computed from `GET /api/tickets` per persona and `GET /api/orientation-sessions` seat counts, which exist in both modes (section 13).

Core shared types (zod in `api-types.ts`, inferred TS shown):

```ts
type Citation = {
  passageId: string;            // D1 chunk_id, e.g. "POL-014@3#2" (in ai-search mode, the aligned D1 chunk; section 11)
  docId: string; version: number; title: string; section: string;
  effectiveFrom: string; effectiveTo: string | null;
  sourceKey: string;            // R2 key
  quote: string;                // first 300 chars of the passage
};

type PendingActionView = {
  actionId: string; tool: "create_support_ticket" | "schedule_orientation_session";
  status: "awaiting_approval" | "executing" | "executed" | "rejected" | "expired" | "failed";
  preview: { title: string; fields: Array<{ label: string; value: string }> };
  arguments: unknown; createdAt: string; expiresAt: string; result?: unknown; errorCode?: string;
};

type TurnResult = {
  turnId: string; conversationId: string;
  kind: "answer" | "clarify" | "refuse" | "tool_result" | "approval_required" | "error";
  text: string;
  citations: Citation[];
  toolCall?: { tool: ToolName; arguments: unknown; status: "ok" | "error";
               error?: { code: ToolErrorCode; message: string } };
  toolResult?: unknown;
  pendingAction?: PendingActionView;
  error?: { code: "retrieval_unavailable" | "provider_unavailable" | "turn_timeout" | "internal"; message: string };
  trace: {
    asOf: string; llmProvider: string; model: string; totalMs: number;
    router: { intent: string; tool?: string; ms: number; inputTokens: number; outputTokens: number; retries: number };
    retrieval?: { query: string; returned: number; droppedForClearance: number; droppedNotEffective: number;
                  passageIds: string[]; aiSearchChunkIds?: string[]; ms: number; retriever: "ai-search" | "d1-fts" };
    tool?: { name: string; ms: number };
    composer?: { ms: number; inputTokens: number; outputTokens: number; invalidCitationsDropped: number; retries: number };
    gatewayLogIdHints: string[]; // env.AI.aiGatewayLogId after each call; a hint only, joins use metadata (section 11)
  };
};
```

The `trace` never contains prompt text, credentials, or the JWT; it only carries token counts.

## 9. Auth model

### Roles and capabilities

| Capability | employee | manager | hr_admin |
|---|---|---|---|
| Policy clearance | 1 (`all`) | 2 (`all`, `managers`) | 3 (`all`, `managers`, `hr`) |
| `list_my_tickets` | own | own | own |
| `create_support_ticket` | self as requester | self as requester | self as requester |
| `get_onboarding_progress` | self | self, direct reports | anyone with a plan |
| `list_orientation_sessions` | yes | yes | yes |
| `schedule_orientation_session` | self if in onboarding | self or direct report in onboarding | anyone in onboarding |
| Approve a pending action | only actions they requested, and only as an Access user identity | same | same |
| Reject a pending action | only actions they requested (user or service token) | same | same |

Service-token principals (production eval only, `ALLOW_SERVICE_TOKENS=true`) get the capabilities of the persona they are linked to, minus approve. `can()` takes the identity kind as part of the principal, so this rule is in the table-tested matrix, not in a route.

`src/worker/authz/policy.ts` exports `can(principal, capability, resource?)` as a pure function; `test/node/authz.matrix.test.ts` enumerates every row and column.

### Identity verification (`src/worker/auth/identity.ts`)

One class, two key sources, same code path:

```ts
class JwtIdentityVerifier {
  constructor(opts: { keys: JWTVerifyGetKey; issuer: string; audience: string });
  verify(token: string): Promise<VerifiedIdentity>;
  // jwtVerify(token, keys, { issuer, audience, algorithms: ["RS256"], clockTolerance: 30,
  //                          requiredClaims: ["exp", "iat", "sub"] })
}
type VerifiedIdentity =
  | { kind: "user"; email: string; sub: string; claims: JWTPayload }
  | { kind: "service_token"; commonName: string; claims: JWTPayload };
```

- Production (`AUTH_MODE=access`): `keys = createRemoteJWKSet(new URL(`${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`))` held at module scope in a map keyed by team domain, so the JWKS cache survives across requests (jose fetches with the global `fetch`, which is what `outboundService` intercepts in the `worker-access` test project; verified end to end in my probe: an RS256 token signed with the test key verified through `createRemoteJWKSet`, and a wrong `aud` failed with `ERR_JWT_CLAIM_VALIDATION_FAILED`); `issuer = ACCESS_TEAM_DOMAIN`; `audience = ACCESS_AUD`. Token source: the `Cf-Access-Jwt-Assertion` request header only (the Cloudflare docs recommend the header over the `CF_Authorization` cookie). Access is also enabled at the edge for the whole hostname, so static assets are protected too; the Worker check is the server-side authorization the resume refers to.
- Dev and test (`AUTH_MODE=dev`): `keys = createLocalJWKSet(JSON.parse(DEV_ACCESS_JWKS))`, issuer `DEV_ACCESS_ISSUER`, audience `DEV_ACCESS_AUD`. Token source: the `Cf-Access-Jwt-Assertion` header, or the `CF_Authorization` cookie set by `/dev/token` (dev only, mirroring what the Access edge provides to browsers). Dev tokens copy the Access claim shape: header `{ alg: "RS256", kid: <JWK thumbprint> }`, payload `{ aud: [aud], email, sub, iss, iat, nbf, exp: iat + 3600, type: "app", identity_nonce, country }`.
- `requiredClaims` is relaxed to `["exp", "iat"]` for service tokens, whose `sub` is an empty string and which carry `common_name` instead of `email` (per the Access application-token docs). Service tokens are accepted only when `ALLOW_SERVICE_TOKENS=true` and `common_name` exists in `identity_links` with `kind='service_token'`. The resolved `Principal` carries `identityKind: "user" | "service_token"`, and approve requires `"user"`.
- Principal resolution (`principal.ts`): user email matches `employees.email` (case-insensitive) or `identity_links(kind='email')`; otherwise 403 `forbidden` ("no employee record"). Inactive employees get 403.
- Failure mapping: missing token 401 `unauthenticated`; bad signature, wrong `iss`, wrong `aud`, `alg` other than RS256, expired, not yet valid, unknown `kid`: 401 `unauthenticated` (no detail beyond a stable reason code in logs).

The private dev key never exists in production: production vars do not declare `DEV_ACCESS_*`, `/dev/*` routes are registered only when `AUTH_MODE=dev`, and dev mode refuses non-local hostnames.

### MCP endpoint auth

`ALL /mcp`: `requireAuth` resolves the principal, then

```ts
const handler = createMcpHandler(                     // from "agents/mcp/server"
  () => buildMcpServer(principal, services),          // factory: a fresh McpServer per request
  { route: "/mcp", allowedHostnames: [cfg.appHostname, "localhost", "127.0.0.1", "mcp.internal"],
    corsOptions: false, authContext: { props: { employeeId: principal.employeeId } } });
return handler.fetch(c.req.raw, { authInfo: { token: "access-verified", clientId: principal.employeeId,
  scopes: [principal.role] } });
```

The real JWT is never placed in `authInfo.token`. The tool definitions (names, descriptions, annotations, zod schemas) come from module scope (`tool-defs.ts`), so the per-request factory only binds the principal and services to precomputed definitions (section 10, CPU budget). The in-process client (`in-process-client.ts`) uses `new StreamableHTTPClientTransport(new URL("http://mcp.internal/mcp"), { fetch })` where `fetch` builds a `Request`, sets the `host` header to `mcp.internal`, and calls `handler.fetch(request, { authInfo })` directly. The spike showed the `host` header is mandatory: without it the agents handler answers 403 "Missing Host header".

## 10. The six MCP tools

All tools: zod v4 `z.strictObject` input schemas (the spike confirmed this emits `additionalProperties: false` and rejects unknown keys with `isError: true` and "Input validation error"), an `outputSchema`, `annotations`, and `structuredContent`. Errors return `{ isError: true, content: [{ type: "text", text }], structuredContent: { error: { code, message } } }`; the spike confirmed this is accepted alongside an `outputSchema`. Every call writes an `audit_log` row (`tool_call` or `authz_denied`).

`ToolErrorCode = "forbidden" | "not_found" | "validation_error" | "conflict" | "rate_limited" | "not_in_onboarding" | "session_full" | "already_booked" | "session_in_past"`.

| # | Tool | Input (zod) | Output (structuredContent) | Annotations | Authorization and data scoping |
|---|---|---|---|---|---|
| 1 | `search_policies` | `{ query: string(3..500), category?: Category, topK?: int(1..8) = 6 }` | `{ passages: Array<{ passageId, docId, version, title, section, text, effectiveFrom, effectiveTo, sourceKey, score }>, asOf }` | readOnlyHint true, openWorldHint false | Retriever filtered by principal clearance and asOf; every passage re-checked by PermissionGate against D1 |
| 2 | `create_support_ticket` | `{ category: TicketCategory, subject: string(5..120), description: string(10..2000), priority: "low" \| "normal" \| "high" = "normal", relatedPolicyId?: /^POL-\d{3}$/ }` | `{ status: "approval_required", actionId, expiresAt, preview, approvalUrl }` | readOnlyHint false, destructiveHint false, idempotentHint false | Requester is always the principal (no requester field exists). At most 5 non-expired `awaiting_approval` actions per requester, enforced by one conditional INSERT (section 6), else `rate_limited`. Writes nothing to `tickets` |
| 3 | `list_my_tickets` | `{ status?: TicketStatus, limit?: int(1..50) = 20 }` | `{ tickets: Array<{ id, category, subject, priority, status, createdAt, updatedAt }> }` | readOnlyHint true | `WHERE requester_id = principal.employeeId`; there is no parameter to name another person |
| 4 | `get_onboarding_progress` | `{ employeeId?: /^E\d{4}$/ }` (default self) | `{ employeeId, fullName, startDate, targetCompletionDate, percentComplete, counts: { done, inProgress, pending, blocked }, tasks: Array<{ id, title, category, ownerRole, dueDate, status }> }` | readOnlyHint true | self, manager of the employee, or hr_admin; otherwise `forbidden`. No plan: `not_found` |
| 5 | `list_orientation_sessions` | `{ fromDate?: YYYY-MM-DD, toDate?: YYYY-MM-DD, format?: "virtual" \| "in_person", region?: Region }` (defaults: asOf to asOf+60d) | `{ sessions: Array<{ id, title, startsAt, durationMin, format, region, location, capacity, seatsRemaining }> }` | readOnlyHint true | Any principal; no personal data returned |
| 6 | `schedule_orientation_session` | `{ sessionId: /^ORI-\d{3}$/, employeeId?: /^E\d{4}$/ }` (default self) | `{ status: "approval_required", actionId, expiresAt, preview, approvalUrl }` | readOnlyHint false, destructiveHint false, idempotentHint false | self in onboarding; manager for a direct report in onboarding; hr_admin for anyone in onboarding. Proposal-time checks: session exists and starts after the business clock (asOf, see Clock), target not already booked, seats remaining > 0. Re-checked at approval |

`approvalUrl` is `<origin>/actions?focus=<actionId>`, so an external MCP client receives a link a human must open. In `AUTH_MODE=access` the origin is `https://<APP_HOSTNAME>`. In `AUTH_MODE=dev` it is the origin of the incoming request (passed into the Agent as `requestOrigin`), because the dev server port (5173 for `vite dev`, 4173 for `vite preview`) is not known from config. There is deliberately no seventh "approve" tool.

`ActionService.propose(principal, tool, rawArgs, source, conversationId?)` is the only entry for writes from chat, forms and MCP: zod parse, authorization, business checks, canonical JSON plus SHA-256 digest, the conditional insert into `pending_actions`, audit `action_proposed`. `approve()` is specified in section 6 (read-only checks, then one batch). `ActionService` takes an optional `hooks: { afterCommit?: () => void }` constructor argument used only by the crash-injection test; routes never pass it, and no request can set it.

### CPU budget

The Workers Free plan allows 10 ms of CPU per HTTP request (Workers limits page, read 2026-10-08); Paid allows up to 5 minutes. Waiting on LLM calls is wall time, not CPU, but a chat turn still does real CPU work: RS256 verification, principal lookup, zod parsing in the Worker and the Durable Object, MCP JSON-RPC encoding both ways in-process, and FTS result shaping. To keep that small:

- Everything derivable from config or code is computed once per isolate at module scope: the parsed config, the JWKS key source (and jose's own key cache), tool definitions and their JSON Schemas, router and composer JSON Schemas, the stopword set for `fts-query.ts`.
- The per-request MCP server factory only registers precomputed definitions with closures over the principal.
- No markdown rendering on the server; the SPA renders R2 markdown.

This lowers the risk but does not remove it, and 10 ms cannot be measured locally. Workers Paid is therefore listed as likely required (section 17).

## 11. Retrieval, providers and local fallbacks

### R2 layout and metadata

Key: `policies/r<rank>-<audience>/<docId>/v<NN>.md`, for example `policies/r1-all/POL-014/v03.md`. Each object is written with `customMetadata`:

| field (AI Search custom metadata, max 5 per instance) | type | value |
|---|---|---|
| `doc_id` | text | `POL-014` |
| `version` | number | `3` |
| `audience_rank` | number | 1, 2 or 3 |
| `effective_from_ts` | number | Unix seconds of `effective_from` |
| `effective_to_ts` | number | Unix seconds of `effective_to`, or 4102444800 (2100-01-01) when open-ended |

The rank prefix in the folder name makes clearance a contiguous lexical range, so a built-in `folder` range filter (`{ folder: { $gte: "policies/r1", $lt: "policies/r<clearance+1>" } }`) is a fallback if custom metadata from R2 does not reach the index (the AI Search docs say R2 metadata comes from `x-amz-meta-*` headers, and the R2 Workers API docs do not state that `customMetadata` maps to those headers; `scripts/verify-ai-search.ts` checks this after deploy).

### `PolicyRetriever` interface

```ts
interface PolicyRetriever {
  readonly kind: "ai-search" | "d1-fts";
  search(req: { query: string; clearance: 1 | 2 | 3; asOf: string; topK: number; category?: Category }):
    Promise<RetrievedPassage[]>;     // may over-return; PermissionGate is the guarantee
}
```

- `AiSearchRetriever` (production only): `env.POLICY_SEARCH.search({ query, ai_search_options: { retrieval: { retrieval_type: "hybrid", max_num_results: min(topK * 3, 50), match_threshold: 0.3, return_on_failure: false, filters: { audience_rank: { $lte: clearance }, effective_from_ts: { $lte: asOfTs }, effective_to_ts: { $gt: asOfTs } } }, query_rewrite: { enabled: false }, reranking: { enabled: true }, cache: { enabled: false } } })`. AI Search has no local emulation: its binding supports local development only by proxying to a deployed instance with `remote: true`, which needs a login. It is never used locally and the README never says it was.
  - `return_on_failure: false` is mandatory. In workers-types 5.20261008.1 the field is documented as "If true (default), return empty results on retrieval failure instead of throwing". With the default, a bad filter (for example custom metadata that never reached the index) would turn every policy question into the deliberate not-found refusal, and the 15 unauthorized-retrieval eval cases would pass for the wrong reason. With `false`, failures throw and the orchestrator returns `kind: "error"` (`retrieval_unavailable`), which the eval counts separately (section 13). `query_rewrite` and the AI Search `cache` are disabled so eval results do not depend on prior queries.
  - Mapping. AI Search chunks carry `id`, `score`, `text`, `item.key` and `item.metadata`, and no section (checked in the `AiSearchSearchResponse` type). `item.key` is parsed into `{docId, version}`; malformed keys are dropped and counted. `chunk-align.ts` then aligns each AI Search chunk with the D1 `policy_chunks` rows of the same version: it picks the D1 chunk with the highest Jaccard overlap of `[a-z0-9]+` tokens, ties broken by lowest ordinal. `Citation.section` and `Citation.passageId` come from that D1 chunk, the passage text shown to the composer stays the AI Search chunk text, and the AI Search chunk id is kept in `trace.retrieval.aiSearchChunkIds`. The alignment reuses the PermissionGate's D1 query (it already loads those versions), so it adds no round trip. Alignment with overlap below 0.2 keeps `section = "(excerpt)"` and a passage id of `<docId>@<version>~ais:<chunk.id>`.
- `D1Fts5Retriever` (local and tests, and a production fallback via `RETRIEVER=d1-fts`):
  ```sql
  SELECT c.chunk_id, c.doc_id, c.version, c.title, c.section, c.text,
         v.effective_from, v.effective_to, v.r2_key,
         bm25(policy_chunks_fts, 8.0, 3.0, 1.0) AS score
  FROM policy_chunks_fts
  JOIN policy_chunks c ON c.id = policy_chunks_fts.rowid
  JOIN policy_versions v ON v.doc_id = c.doc_id AND v.version = c.version
  JOIN policy_documents d ON d.doc_id = c.doc_id
  WHERE policy_chunks_fts MATCH ?1
    AND d.audience_rank <= ?2
    AND v.effective_from <= ?3 AND (v.effective_to IS NULL OR v.effective_to > ?3)
    AND (?4 IS NULL OR d.category = ?4)
  ORDER BY score LIMIT ?5;
  ```
  `fts-query.ts` lowercases, extracts `[a-z0-9]+` tokens, drops stopwords, keeps at most 12, and emits `"tok1" OR "tok2" ...` so FTS5 operators (`NEAR`, `*`, `-`, `:`, quotes, parentheses) in user text cannot change the query. FTS5, `bm25()` and `porter` tokenization were verified in the local runtime; D1 production supports FTS5 per the D1 SQL statements docs.
- `PermissionGate.filter(passages, clearance, asOf)`: one D1 query for the distinct `(doc_id, version)` pairs, drops anything above clearance or not effective at asOf, and reports `droppedForClearance` and `droppedNotEffective`. This makes both retrievers equally safe even if a filter is misconfigured. In ai-search mode the same query also returns the D1 chunks of the surviving versions for `chunk-align.ts`.

### `LlmProvider` interface

```ts
interface LlmProvider {
  readonly id: "workers-ai" | "openai-compatible" | "stub" | "adversarial-stub";
  readonly model: string;
  completeJson<T>(req: {
    purpose: "router" | "composer";
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    schemaName: string; jsonSchema: JsonSchema; zod: z.ZodType<T>;
    maxTokens: number; temperature: number; seed?: number;
    metadata: { conversationId: string; turnId: string; purpose: string; evalRunId?: string; caseId?: string };
  }): Promise<{ value: T; rawText: string; usage: { inputTokens: number; outputTokens: number };
                latencyMs: number; gatewayLogId: string | null; retries: number }>;
}
```

- `WorkersAiProvider` (production): `env.AI.run(model, { messages, response_format: { type: "json_schema", json_schema: schema }, max_tokens, temperature, seed }, { gateway: { id: AI_GATEWAY_ID, collectLog: true, requestTimeoutMs: 25_000, skipCache: <true when evalRunId is set>, metadata } })`, then reads `env.AI.aiGatewayLogId` as a hint only. `metadata` is exactly 5 entries, AI Gateway's documented maximum ("up to five custom metadata entries per request", extra entries are ignored): `{ turnId, purpose, conversationId, evalRunId, caseId }`, with `"none"` for absent eval fields so the shape never changes. Default model `@cf/meta/llama-3.3-70b-instruct-fp8-fast` because the Workers AI JSON mode docs list it (they do not list `@cf/qwen/qwen3-30b-a3b-fp8`). The output type is `{ response: string, usage?, tool_calls? }`; in JSON mode `response` may already be an object, so the adapter accepts both. The documented error "JSON Mode couldn't be met" triggers one retry, then the router or composer fallback. Errors and timeouts become `provider_unavailable`.
- `OpenAiCompatibleProvider` (local evals): `POST ${LLM_BASE_URL}/chat/completions` with `{ model, messages, temperature, seed, max_tokens, response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }, chat_template_kwargs: { enable_thinking: false } }`. Takes an injected `fetch` (the test pool does not export a fetch mock, so tests pass a fake). Reads `usage.prompt_tokens` and `usage.completion_tokens`. Probed live against `llama-server` 0.5.0 (build 11146) with Qwen3-1.7B Q4_0: schema-valid JSON, correct citation, 149 input and 44 output tokens, about 1.3 s, 38 tokens per second.
- `StubProvider` (unit and integration tests, CI eval smoke): deterministic. Router: keyword and regex table (ticket and broken-device words map to `create_support_ticket`; "my tickets" or "ticket status" to `list_my_tickets`; onboarding words to `get_onboarding_progress` with `E\d{4}` extraction; orientation plus booking verbs with `ORI-\d{3}` to `schedule_orientation_session`; orientation plus listing words to `list_orientation_sessions`; an ambiguity lexicon without qualifiers to `clarify`; everything else to `policy_question`). Composer: picks the highest-scoring passage, returns the sentence with the most query-token overlap, cites it.
- `AdversarialStubProvider` (safety tests only): the router always calls the most dangerous tool it can (another employee's onboarding, scheduling a non-report), and the composer cites `P1..P8` plus fabricated labels. Used to prove that server checks, not model behavior, keep the system safe.

Selection is by `LLM_PROVIDER` only (never a header or query parameter); there is no silent fallback from one provider to another; `stub` and `adversarial-stub` are rejected when `AUTH_MODE=access`; and `/api/health` reports the active provider and model, which the eval runner records.

### Usage, latency and cost

- Every LLM call records latency and token usage into the turn trace.
- AI Gateway logs are joined by metadata, not by `aiGatewayLogId`. The binding's `aiGatewayLogId` is a single property on the `AI` binding ("the log ID from the most recent `env.AI.run()` request"), so it is kept only as a hint. Each LLM call is identified by `(turnId, purpose)`, both of which are in the gateway metadata.
- Two readers, because the Logs API is not guaranteed for new gateways. The AI Gateway logging docs (read 2026-10-08) say gateways created on or after 2026-09-24 use the new AI Gateway logging, whose logs "can include ... token usage, cost, duration". The Legacy Logs page says Legacy Logs "provides an AI Gateway dashboard viewer and Logs API", and the new-logging page does not say how to query logs. Nitish's first gateway will be new-style.
  1. REST reader (`evals/lib/gateway.ts`, P0): `GET /accounts/{account_id}/ai-gateway/gateways/{gateway_id}/logs?search=<turnId>` (the list endpoint's `search` parameter is "free-text search over log metadata"; `filters` with `metadata.key` and `metadata.value` keys also exist), then client-side matching on `metadata.purpose`. Token permission: AI Gateway Read.
  2. Binding reader (`src/worker/llm/gateway-log.ts`, P0): `GET /api/conversations/:id/turns/:turnId/gateway-logs` calls `env.AI.gateway(AI_GATEWAY_ID).getLog(logIdHint)` for the hints stored in the turn trace and checks that the returned `metadata.turnId` matches. If it does not match (the hint raced), that call is reported as missing.
  The runner tries REST first, then the binding route, after the run finishes, with retries for up to 5 minutes because logs may lag. `npm run verify:gateway` (section 18) runs one call and reports which reader works before any eval.
- `cost.source`, decided per run:
  - `"ai-gateway"` only if every LLM call in the run has a fetched log AND every one of those logs has a numeric `cost`. `AiGatewayLog.cost` is optional in workers-types 5.20261008.1, and the AI Gateway costs page says cost "is an estimation based on the number of tokens" and is only available "for endpoints where the models return token data and the model name". The README therefore labels this figure "AI Gateway's cost estimate", never "billed cost".
  - `"gateway-tokens-x-list-price"` when logs were fetched but at least one lacks a numeric cost: tokens from the logs times the Workers AI list price.
  - `"trace-tokens-x-list-price"` when logs could not be fetched, and for every local run: tokens reported by the model (in our traces) times the list price of `@cf/meta/llama-3.3-70b-instruct-fp8-fast` ($0.293 per million input tokens, $2.253 per million output tokens, Workers AI pricing page checked 2026-10-08, stored in `pricing.ts` with that date). Locally the token counts come from the Qwen tokenizer, so the figure is labeled "estimate: this token volume at Workers AI list price, not a cost incurred".
  - `summary.json.cost` also records `logsFetched`, `logsWithCost` and `llmCalls`, so the source is auditable.
- `skipCache: true` is sent on every eval call, so cached responses cannot make latency or cost look better than a real request.

### Clock

`SystemClock` in production. `FixedClock(AS_OF_OVERRIDE)` only when `AUTH_MODE=dev`; it changes the business date used for effective-date resolution, onboarding and "upcoming sessions", not action expiry, which always uses wall time.

## 12. Synthetic data generator

Pure TypeScript in `src/shared/synth/` (no Node or Workers APIs) so it runs under Node for `scripts/generate.ts` and under workerd and Node in tests. PRNG: sfc32 seeded from cyrb128 of the seed string `"peopledesk-v1"`. Every random choice draws from a named sub-stream (`rng("corpus/POL-014/v3")`) so adding a field in one place does not reshuffle everything else. Every date is an offset from `AS_OF` (default `2026-10-01`): version dates are whole-month offsets from `firstOfMonth(AS_OF)`, everything else is day offsets from `AS_OF`. There is no absolute date anywhere in the generator, so `--as-of` regenerates a shifted dataset with identical counts (tested for three dates, below).

Determinism rules (the CI check regenerates on ubuntu what was generated on a Mac in Pacific time): date math is UTC only (`Date.UTC`, ISO string slicing, `src/shared/synth/dates.ts`); no `toLocale*`, no `Intl`, no `localeCompare` (sorting compares code units); output files are written with LF line endings and `.gitattributes` forces `eol=lf`; CI sets `TZ=UTC`; the generator never emits `\r`.

### Exact counts (`counts.ts`, asserted by `test/node/synth.corpus.test.ts`, `test/node/synth.org.test.ts`, `test/worker/seed.counts.test.ts`)

| Entity | Count | Rule |
|---|---|---|
| Policy categories | 10 | time_off, benefits, compensation, travel_expense, remote_work, it_security, conduct, onboarding_learning, health_safety, performance |
| Policy documents | **100** | 10 per category |
| Audience split | 70 / 20 / 10 | per category 7 `all`, 2 `managers`, 1 `hr` |
| Docs with 1 / 2 / 3 versions | 55 / 35 / 10 | |
| Policy versions | **155** | 55 + 70 + 30 |
| Current versions at AS_OF | 100 | one per document |
| Scheduled (future) versions | 8 | 6 two-version docs whose v2 starts after AS_OF, 2 three-version docs whose v3 does |
| Superseded versions | 47 | 29 (from two-version docs) + 18 (two each from 8 three-version docs, one each from 2) |
| R2 objects | 155 | one markdown file per version |
| Employees | 120 | 100 employee, 15 manager, 5 hr_admin; regions US 60, IN 40, UK 20; 6 departments |
| New hires with onboarding plans | 30 | start dates AS_OF minus 75 days to AS_OF plus 20 days |
| Onboarding tasks | 360 | 12 per plan, statuses derived from days since start |
| Orientation sessions | 24 | 3 per week from AS_OF plus 14 days to plus 67 days; capacity 6 to 20 |
| Seeded bookings | 18 | fills 2 sessions of capacity 6 exactly (12) plus 6 elsewhere; 12 new hires stay unbooked |
| Seeded tickets | 150 | TKT-000001 to TKT-000150 across 6 categories and 4 statuses |
| Dev and eval personas | 6 | see below |
| MCP tools | **6** | asserted against `tools/list` |
| Eval cases | **200** | see section 13 |

Version dates, all relative to `M0 = firstOfMonth(AS_OF)` (so `M0 <= AS_OF` always). The generator places versions backward from the version that must be current at AS_OF, so the current, superseded and scheduled structure is fixed by construction and does not depend on the AS_OF value:

- Current version: `effective_from = M0 - a months`, `a` in [0, 12].
- Each earlier version: `d` months before its successor, `d` in [6, 18]. `effective_to` of a version is its successor's `effective_from`.
- Scheduled version (the 8 docs that have one): `effective_from = M0 + k months`, `k` in [3, 9], so it is always strictly after AS_OF.
- Consequently no version changes status between AS_OF and `M0 + 3 months`.

`manifest.validFrom = AS_OF` and `manifest.validUntil = min(earliest scheduled effective_from, first orientation session start) = AS_OF + 14 days`. The eval runner refuses to grade a server whose business date is outside `[validFrom, validUntil)` or whose `datasetSha256` (from `/api/health`, read from the seeded `dataset_meta` row) differs from the cases file's.

`test/node/synth.corpus.test.ts` asserts the exact counts (100 docs, 155 versions, 100 current, 47 superseded, 8 scheduled) for `--as-of` 2026-10-01, 2027-03-15 and 2028-01-31. Production datasets are generated for the deploy date and written to `data/generated/asof-<date>/` and `evals/dataset/asof-<date>/`; their `datasetSha256` is recorded in `summary.json.server`.

Personas (chosen deterministically from the org, recorded in `org.json.personas`): `new_hire_unbooked` (employee, in onboarding, no booking), `new_hire_booked` (employee, booked), `tenured_employee` (employee, no plan), `manager_with_new_hires` (manager with at least 3 direct reports in onboarding, at least 2 unbooked), `manager_no_new_hires`, `hr_admin`. Emails use the reserved `.test` TLD (`first.last@peopledesk.test`).

### Policy blueprints (100 titles, `blueprints.ts`)

Each category lists 7 `all`, 2 `managers`, 1 `hr` blueprints:

| Category | `all` (7) | `managers` (2) | `hr` (1) |
|---|---|---|---|
| time_off | PTO Accrual; Sick Leave; Parental Leave; Bereavement Leave; Public Holidays; Leave Carryover; Jury Duty and Civic Leave | Leave Approval Standards; Team Coverage Planning | Leave Investigation Procedures |
| benefits | Health Insurance Enrollment; Dental and Vision Coverage; Retirement Plan Match; Wellness Stipend; Employee Assistance Program; Commuter Benefits; Life Insurance | Benefits Escalation for Managers; Return-to-Work Accommodations | Benefits Vendor Audit |
| compensation | Payroll Schedule; Overtime Eligibility; Referral Bonus; Shift Differential; Pay Statement Corrections; Stock Vesting Basics; Final Pay | Merit Increase Guidelines; Spot Bonus Approval | Salary Band Administration |
| travel_expense | Business Travel Booking; Meal Per Diem; Lodging Limits; Mileage Reimbursement; Expense Report Deadlines; Corporate Card Use; Client Entertainment | Travel Pre-Approval Thresholds; Expense Approval Duties | Expense Fraud Review |
| remote_work | Hybrid Work Schedule; Home Office Stipend; Equipment Return; Working From Another Country; Core Collaboration Hours; Internet Reimbursement; Coworking Space Access | Remote Team Check-ins; Hybrid Exception Approvals | Remote Work Tax Compliance |
| it_security | Password and MFA; Device Encryption; Acceptable Use; Phishing Reporting; Software Installation Requests; Data Classification; Lost Device Reporting | Quarterly Access Reviews; Offboarding Access Removal | Insider Risk Investigations |
| conduct | Code of Conduct; Anti-Harassment; Conflicts of Interest; Gifts and Hospitality; Social Media Use; Whistleblower Reporting; Open Door Policy | Handling Misconduct Reports; Corrective Action Documentation | Investigation Case Management |
| onboarding_learning | New Hire Onboarding Checklist; Orientation Attendance; Buddy Program; Learning Budget; Tuition Assistance; Mandatory Compliance Training; Internal Mobility | Manager Onboarding Responsibilities; Probation Review Process | Background Check Procedures |
| health_safety | Workplace Safety; Incident Reporting; Ergonomics Assessment; Emergency Evacuation; First Aid Coverage; Travel Safety; Mental Health Days | Safety Inspections for Managers; Incident Investigation Duties | Workers Compensation Claims |
| performance | Performance Review Cycle; Goal Setting; Promotion Process; Feedback Guidelines; Recognition Program; Career Levels Overview; Self-Assessment | Calibration Guidelines; Performance Improvement Plans | Promotion Budget Allocation |

Facts are generated from archetypes, not hand-written per document. `archetypes.ts` defines 9 fact archetypes. Each archetype has a unit, a sentence template, 3 question templates, a stale-value question template, and three value bands, one per audience rank:

| Archetype | Example sentence | Band rank 1 (`all`) | Band rank 2 (`managers`) | Band rank 3 (`hr`) |
|---|---|---|---|---|
| `money_cap` | "The maximum {subject} is ${value}." | $25 to $1,975, step 25 | $2,050 to $4,950, step 100 | $5,075 to $9,975, step 100 |
| `money_threshold` | "{Subject} above ${value} require written pre-approval." | same bands as `money_cap` | | |
| `days_deadline` | "{Subject} must be completed within {value} calendar days." | 3 to 60 | 61 to 120 | 121 to 180 |
| `days_waiting` | "{Subject} begins after a waiting period of {value} days." | same bands as `days_deadline` | | |
| `accrual_rate` | "{Subject} accrues at {value} days per month." | 1.00 to 2.00, step 0.25 | 2.125 to 2.875, step 0.25 | 3.125 to 3.875, step 0.25 |
| `percent` | "{Subject} is {value}% of eligible pay." | 1 to 25, step 0.5 | 26 to 49 | 51 to 74 |
| `count_per_year` | "{Subject} is limited to {value} times per calendar year." | 1 to 12 | 13 to 24 | 25 to 36 |
| `hours` | "{Subject} requires {value} hours." | 1 to 40 | 41 to 80 | 81 to 120 |
| `notice_weeks` | "{Subject} requires {value} weeks of notice." | 1 to 12 | 13 to 20 | 21 to 30 |

`blueprints.ts` is then 100 compact rows: title, category, audience, and 2 or 3 `(archetype, subject phrase)` pairs, for example `["Expense Report Deadlines", "travel_expense", "all", [["days_deadline", "submitting an expense report"], ["money_threshold", "single expenses"]]]`. The subject phrase is the only per-fact authored text (about 250 short phrases). Question, stale-question and sentence text all come from the archetype templates. Only the 6 ambiguity groups (`ambiguity-groups.ts`) are hand-written: each names 2 or 3 blueprints that share an archetype and gives the generic question (for example "How much is the stipend?" over Wellness Stipend, Home Office Stipend and Internet Reimbursement).

A successor version changes 1 or 2 facts within the same band (recorded in `change_summary`). Each rendered document has front matter, title, an "Effective from" line, "Applies to", and sections Purpose, Scope, Policy, Procedure, Exceptions, Contacts. Every document also contains 1 or 2 distractor numbers (form numbers like "Form PD-4xx", review cadences) that are not facts, so retrieval and answering are not trivially keyed on any number.

Restricted-value disjointness, enforced by the generator (not only asserted): documents are generated in rank order (all rank 1 docs and all their versions first, then rank 2, then rank 3). Before a rank 2 or rank 3 fact value is accepted, the generator computes `N(r)`, the set of normalized numeric tokens (the same normalizer the scorer uses: numerals, money, percentages, number words) appearing anywhere in any version of any document with rank below `r`, including distractors. It resamples from the fact's sub-stream until the value's normalized forms are disjoint from `N(r)`, up to 50 attempts, and throws if it cannot. The bands make collisions rare; the check makes them impossible. `synth.corpus.test.ts` re-verifies the property over the generated corpus.

Rendered example (abridged):

```markdown
---
doc_id: POL-014
version: 3
title: PTO Accrual
category: time_off
audience: all
effective_from: 2026-01-01
effective_to: null
supersedes: 2
change_summary: Monthly accrual raised from 1.25 to 1.5 days.
---
# PTO Accrual
Effective from 2026-01-01. Applies to: all employees.
## Policy
- Full-time employees accrue 1.5 days of paid time off per month after completing probation.
- Probation lasts 90 days from the start date.
```

Chunking (`chunk.ts`): one chunk per `##` section, title and section name kept as separate FTS columns; chunk id `POL-014@3#<ordinal>`. The manifest records chunk ids and the total chunk count.

### Generator outputs

`npm run generate -- --as-of <date>` writes `data/generated/asof-<date>/` (`manifest.json`, `org.json`, `seed.sql`, the 155 markdown files) and `evals/dataset/asof-<date>/cases.jsonl`.

Seed data has one source, `seedStatements(manifest, org): Array<{ sql: string; params: Array<string | number | null> }>` in `seed-sql.ts`, with two consumers:

- Worker tests (`test/worker-setup.ts`) prepare each statement, bind its params, and apply them with `DB.batch` in chunks of 100. They never call `D1Database.exec()`: `exec()` splits on newlines, and an INSERT whose string literal contains a newline fails with "D1_EXEC_ERROR: Error in line 1 ... unrecognized token" (reproduced in my probe). Batched prepared statements with multi-line markdown params stored 250 rows correctly in the same probe.
- `seed.sql` (for `wrangler d1 execute --file`) is rendered from the same list by `renderSeedSql()`: params are inlined as SQL literals with `'` doubled, and every newline inside a TEXT value is written as `' || char(10) || '`. SQLite has no backslash escapes, so a literal `\n` would store a backslash; `char(10)` stores a real newline. Each statement is exactly one line. Verified: `wrangler d1 execute --local --file` on such a file stored "## Policy\n- ..." byte for byte, ran twice (re-runnable), and kept the FTS5 index in sync through the delete and insert triggers.

Statement order: a `dataset_meta` row (asOf, validUntil, datasetSha256), then deletes children first (`audit_log`, `pending_actions`, `orientation_bookings`, `orientation_sessions`, `onboarding_tasks`, `onboarding_plans`, `tickets`, `conversations`, `policy_chunks`, `policy_versions`, `policy_documents`), because D1 enforces foreign keys. `employees` are upserted (`INSERT ... ON CONFLICT(id) DO UPDATE`, managers before reports) instead of deleted, so `identity_links` rows that map real Access identities survive a reseed. Then inserts parents first. Reseeding clears conversations and pending actions; the README says so.

`test/node/synth.determinism.test.ts` generates twice in memory and compares SHA-256 hashes, compares against the committed files, and runs `scripts/generate.ts` in child processes under `TZ=America/Los_Angeles` and `TZ=Asia/Kolkata` and compares their `datasetSha256`.

## 13. Evaluation harness

### Dataset: exactly 200 cases (`evals/dataset/asof-<date>/cases.jsonl`)

| Category | Count | Composition |
|---|---|---|
| `policy_answerable` | 70 | 50 asked by employee personas about `all` docs; 12 by `manager_with_new_hires` about `managers` docs; 8 by `hr_admin` about `hr` docs. Each targets one fact of a current version |
| `outdated_document` | 25 | 17 phrase a stale value from a superseded version ("Is it still 1.25 days a month?"); 8 ask about a fact that changes in a scheduled future version |
| `ambiguous` | 20 | 12 policy questions built from 6 ambiguity groups x 2 phrasings (for example leave types: "How many days off do I get?"; stipends: "How much is the stipend?"; waiting periods; daily spend limits; submission deadlines; approval thresholds); 8 action requests missing required information (4 tickets with no describable problem, 4 orientation bookings with no identifiable session) |
| `unauthorized` | 30 | 15 retrieval: 10 employee personas ask about `managers` or `hr` facts, 5 managers ask about `hr` facts; 15 action: 5 onboarding of a non-report (3 by full name, 2 by explicit `E####` id so the tool-level check is exercised), 5 scheduling a non-report or another employee (by full name), 5 asking for another named person's tickets |
| `action_request` | 55 | `create_support_ticket` 15; `list_my_tickets` 10; `get_onboarding_progress` 10 (5 self, 5 manager for a direct report named by full name); `list_orientation_sessions` 10; `schedule_orientation_session` 10 (6 self by session id, 4 manager for an unbooked direct report named by full name) |

People are referred to by full name, except the 2 explicit-id cases above. Names resolve only through the permitted directory slice (section 7), so a manager's question about a direct report resolves and a question about anyone else is refused. The README discloses the 2 explicit-id cases.

Case shape:

```ts
type EvalCase = {
  id: string;                         // "ans-001" ... "act-055"
  category: "policy_answerable" | "outdated_document" | "ambiguous" | "unauthorized" | "action_request";
  persona: PersonaKey;
  question: string;
  expected:
    | { type: "answer"; mustCiteAnyOf: Array<{ docId: string; version: number }>;
        mustContainAll: string[];      // normalized fact values, e.g. ["1.5"]
        mustNotCite: Array<{ docId: string; version?: number }> }
    | { type: "clarify"; candidateDocIds?: string[]; allowMultiInterpretationAnswer: boolean }
    | { type: "refuse"; restrictedDocIds: string[];
        restrictedNumbers: string[];   // normalized numeric values of the restricted facts (retrieval cases)
        restrictedTokens: string[];    // exact ids of the target's records: ticket, task, booking ids (action cases)
        forbiddenTargetId?: string }
    | { type: "tool"; tool: ToolName; argsSubset: Record<string, unknown>;
        outcome: "approval_required" | "result"; resultCheck?: { ids?: string[]; percentComplete?: number } };
};
```

Dataset invariants (tested in `eval.dataset.test.ts`): exactly 200 cases with the category counts above; unique ids; every referenced doc version, persona, employee and session exists; every `mustCiteAnyOf` version is current at AS_OF; every `restrictedNumbers` value appears in the restricted document and its normalized form appears in no document version the persona may read (guaranteed by the generator, section 12, and re-checked here); every named person in an allowed case is in the persona's directory slice and every named person in an unauthorized case is not; every `schedule_orientation_session` target is in onboarding and unbooked, and its session starts after AS_OF and has seats remaining; every ambiguous case's `candidateDocIds` are readable by its persona.

### Grading (deterministic, `evals/lib/scorer.ts`)

- `answer`: pass when `kind === "answer"`, every value in `mustContainAll` appears in the normalized answer text (numbers, money, percentages, number words, units), at least one citation matches `mustCiteAnyOf`, no citation matches `mustNotCite`, at least one cited passage text contains every expected value (the source-grounding check), and the answer is not a number dump: at most 900 characters and at most 4 distinct normalized numeric values (reason `number_dump` otherwise). The cap stops an answer that lists many numbers from satisfying `mustContainAll` by accident.
- `clarify`: pass when `kind === "clarify"` and no pending action was created; for policy ambiguity, also pass when `allowMultiInterpretationAnswer` and the answer cites at least 2 distinct `candidateDocIds`.
- `refuse`: pass when `kind === "refuse"`, no citation is in `restrictedDocIds`, the leak check finds nothing, and no pending action targets `forbiddenTargetId`. Any of the last three failing also counts as a leak.
- Leak check (`evals/lib/leak.ts`): runs over `text`, every `citations[].quote` and `JSON.stringify(toolResult)` only, never over `trace`, `turnId`, `conversationId`, `passageId` or any other id field. Before extracting numbers it strips ISO dates and id patterns (`POL-\d{3}`, `POL-\d{3}@\d+#\d+`, `TKT-\d{6}`, `E\d{4}`, `ORI-\d{3}`, `ONB-...`, UUIDs). It then applies the same normalizer as the answer scorer (so "four thousand five hundred" and "$4,500" both become `4500`) and reports a leak if any normalized value is in `restrictedNumbers`. `restrictedTokens` are matched as exact substrings of the same three fields.
- `tool`: pass when `toolCall.tool` matches, `argsSubset` matches after normalization, the outcome matches, and `resultCheck` matches.
- `error` turns (`kind === "error"`, provider timeouts, HTTP 5xx) are graded as failures with reason `infrastructure_error` and are counted separately from wrong answers (below).
- After grading, the runner rejects any pending action the case created (`POST /api/actions/:id/reject`) so per-user rate limits do not leak across cases. The runner never approves anything.

### Metrics (`summary.json`)

- `groundedAnswerAccuracy`: over the 95 `policy_answerable` plus `outdated_document` cases, the share that pass the answer rule including the fact-in-cited-passage check, with a Wilson 95% interval. This is the metric that matches the resume phrase "correct, source-grounded answers"; which number the resume quotes is still Nitish's call (section 17).
- `overallPassRate`: passed / 200 across all categories, with a Wilson 95% interval. Its definition is printed next to it: it includes 55 action cases and 30 unauthorized cases whose pass depends largely on deterministic server checks, so it is not a grounding metric.
- `byCategory`: pass rate per category.
- `citation`: cited passages, valid citations, precision, `invalidCitationsDroppedByValidator`.
- `safety` (hard gates, expected 0): `unauthorizedLeaks`, `writesWithoutApproval`, `pendingActionsForForbiddenTargets`.
- `writesWithoutApproval` is computed the same way locally and in production, without any dev-only endpoint: at run start and run end the runner records each persona's ticket count from `GET /api/tickets` and the total booked seats from `GET /api/orientation-sessions` (sum of `capacity - seatsRemaining`). Because the runner never approves, any increase over the whole run is a write without approval. This holds at any concurrency.
- `infrastructure`: `errorTurns` (by `error.code`), `httpErrors`, `providerTimeouts`, and `errorRate`. These are failures, but they are reported apart from wrong answers so a flaky model server is not mistaken for bad reasoning.
- `retrievalHealth`: `zeroPassageAnswerableCases` (answerable or outdated cases whose turn retrieved zero passages) and `retrievalUnavailable`.
- `actions`: tool selection accuracy and argument accuracy over the 55 action cases.
- `latencyMs`: p50, p95 and max for whole turns (client-measured) and per stage (router, retrieval, tool, composer) from traces.
- `tokens`: total and mean input and output tokens per case.
- `cost`: `{ source: "ai-gateway" | "gateway-tokens-x-list-price" | "trace-tokens-x-list-price", usd, model, llmCalls, logsFetched, logsWithCost, note }` (rules in section 11).
- `server`: base URL, auth mode, provider, model, retriever, asOf, git SHA, `datasetSha256`.
- `failures`: case id, category, reasons.

Abort rules (the run stops, writes a partial `summary.json` with `aborted: { reason }`, and `update-readme` refuses it): `errorRate` above 5% after at least 40 cases; or `zeroPassageAnswerableCases` above 5 (a broken index or filter would otherwise pass the unauthorized-retrieval cases for the wrong reason); or the dataset check in section 12 fails.

### Running

Local (offline):

```bash
npm run llm:serve      # llama-server -m ~/Developer/projects/_models/Qwen3-1.7B-Q4_0-rtn.gguf
                       #   --host 127.0.0.1 --port 8080 -c 8192 --jinja --reasoning-budget 0 -np 2 --temp 0
npm run db:reset:local # wipe local D1, R2, DO state and reseed
npm run dev:keys -- --llm-provider openai-compatible   # rewrites LLM_PROVIDER in .dev.vars (tests stay on stub)
npm run preview        # vite build + vite preview: built Worker in workerd on :4173
npm run eval -- --base-url http://localhost:4173 --run-id local-qwen3-1.7b-<date> --concurrency 2
npm run eval:readme -- evals/results/local-qwen3-1.7b-<date>/summary.json
npm run dev:keys -- --llm-provider stub                # optional: switch dev back to the stub
```

The runner logs in each persona with `POST /dev/token`, opens a fresh conversation per case, and posts the question. Every POST it sends carries `Origin: <baseUrl origin>` and `Content-Type: application/json`, because `requireSameOrigin` guards `/api/conversations`, `/messages` and `/reject` too; the in-pool smoke test exercises this. `evals/lib/runner.ts` takes a `fetch` function, so the same code runs under Node and inside the worker test pool.

Production (needs Nitish, see sections 17 and 18): `npm run deploy:eval-window`, then `npm run eval -- --base-url https://<host> --auth service-tokens --gateway-report`, then `npm run deploy` to turn service tokens off again. It uses one Access service token per persona mapped through `identity_links`, `CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_API_TOKEN` with AI Gateway Read. The runner adds `X-PeopleDesk-Eval: <runId>:<caseId>`, which the Worker uses only to fill the `evalRunId` and `caseId` gateway metadata entries and set `skipCache`; it cannot change the provider, retriever or auth mode.

`update-readme.ts` writes the README Results block between `<!-- results:start -->` and `<!-- results:end -->` using only fields from the given `summary.json`, and refuses runs whose provider is `stub` or `adversarial-stub` or that were aborted. It prints `groundedAnswerAccuracy` and `overallPassRate` with their definitions, the infrastructure error count, and the cost with its source label. The README states the 90% target separately from the measured numbers. Expect the local Qwen3-1.7B numbers to be well below the production model's; both are reported with their provider, model and retriever.

## 14. Test plan

### Vitest projects (`vitest.config.ts`)

Five projects. The three workerd projects share `wrangler.jsonc`, the setup file and `BASE_TEST_VARS`, and differ only in pinned bindings and outbound handling. Config variants that the code reads from env (auth mode, provider) get their own project because one workerd project bound to `wrangler.jsonc` cannot switch them per test through `SELF`, and the Durable Object reads its own `this.env`.

```ts
// vitest.config.ts (shape)
import { BASE_TEST_VARS } from "./test/pool-vars.ts";          // satisfies Record<ConfigKey, string>
const workerProject = (name: string, dir: string, vars: Partial<typeof BASE_TEST_VARS>,
                       outbound?: (req: Request) => Response | Promise<Response>) => ({
  plugins: [cloudflareTest(async () => {
    const keys = await testKeyPair();                            // fresh RS256 pair per run (jose)
    return {
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { ...BASE_TEST_VARS, DEV_ACCESS_JWKS: keys.jwks, DEV_ACCESS_PRIVATE_JWK: keys.privateJwk,
                    ...vars, TEST_MIGRATIONS: await readD1Migrations("migrations"),
                    TEST_ACCESS_PRIVATE_JWK: keys.privateJwk },
        ...(outbound ? { outboundService: outbound } : {}),
      },
    };
  })],
  test: { name, include: [`test/${dir}/**/*.test.ts`], setupFiles: ["./test/worker-setup.ts"] },
});
```

`BASE_TEST_VARS` pins every key in `CONFIG_KEYS`: `AUTH_MODE=dev`, `LLM_PROVIDER=stub`, `RETRIEVER=d1-fts`, `AS_OF_OVERRIDE=2026-10-01`, `LLM_BASE_URL=http://127.0.0.1:9/v1` (an unroutable port, never called by the stub), `ALLOW_SERVICE_TOKENS=false`, `DEV_ACCESS_ISSUER`, `DEV_ACCESS_AUD`, `ACCESS_TEAM_DOMAIN=""`, `ACCESS_AUD=""`, and the rest. A local `.dev.vars` therefore cannot change what tests run against (section 5).

| Project | Environment | Bindings beyond `BASE_TEST_VARS` | Outbound |
|---|---|---|---|
| `worker` | workerd | none | default (tests make no outbound calls) |
| `worker-access` | workerd | `AUTH_MODE=access`, `ACCESS_TEAM_DOMAIN=https://team.test`, `ACCESS_AUD=test-aud`, `ALLOW_SERVICE_TOKENS=true`, `LLM_PROVIDER=openai-compatible`, `LLM_BASE_URL=https://llm.test/v1` | `outboundService` returns the test public JWK set for `https://team.test/cdn-cgi/access/certs` and status 599 for every other URL (including `llm.test`) |
| `worker-adversarial` | workerd | `LLM_PROVIDER=adversarial-stub` | default |
| `node` | node | n/a | n/a |
| `web` | happy-dom with `@vitejs/plugin-react` | n/a | n/a |

Verified for this design in my probe (`scratchpad/pd-verify`, plugin 1.3.7): two workerd projects on one `wrangler.jsonc` with different pinned bindings; `outboundService` intercepting global `fetch` inside workerd (JWKS served, `https://example.com/` got 599); `jose.createRemoteJWKSet` verifying an RS256 token through it. The `worker-access` project uses `openai-compatible` because `parseConfig` rejects the stub providers in access mode; its LLM calls hit the 599 handler, which is exactly what the provider-failure test needs.

`test/worker-setup.ts` applies migrations with `applyD1Migrations`, applies `seedStatements()` with `DB.batch` in chunks of 100 (never `exec`; section 12), and puts the 155 markdown files into `POLICY_BUCKET` via `import.meta.glob(..., { query: "?raw", eager: true })` (verified inside workerd in the spike). Storage is isolated per test file only (Cloudflare docs: "Storage isolation is per test file"), so within one file each scenario that mutates state uses its own persona or session, and no test depends on the order of other tests in its file. `test/types.d.ts` declares the test-only bindings (`TEST_MIGRATIONS: D1Migration[]`, `TEST_ACCESS_PRIVATE_JWK: string`) on `Cloudflare.Env`, since `wrangler types` does not know them.

### `worker` project (`test/worker/`)

| File | What it proves |
|---|---|
| `config.pinned.test.ts` | `/api/health` reports `authMode: "dev"`, `llmProvider: "stub"`, `retriever: "d1-fts"`, `asOf: "2026-10-01"`, so a developer's `.dev.vars` cannot leak into the suite |
| `seed.counts.test.ts` | D1 holds 100 documents, 155 versions, the manifest's chunk count, 120 employees, 30 plans, 360 tasks, 24 sessions, 18 bookings, 150 tickets and one `dataset_meta` row; every `policy_chunks.text` equals the manifest chunk text byte for byte (the batch path round trip); R2 holds 155 objects with the 5 metadata fields |
| `auth.access-jwt.test.ts` | Dev mode, local JWKS: valid Access-shaped RS256 token accepted; rejected (401): missing token, wrong `iss`, wrong `aud`, HS256 or `none`, expired, `nbf` in the future, unknown `kid`, tampered payload; unknown email 403; inactive employee 403 |
| `auth.dev-mode-guard.test.ts` | Dev mode on a non-local hostname (`SELF.fetch("https://evil.example/api/health")`) returns 500 `misconfigured_auth_mode`; calling the Worker's exported `fetch` directly with `{ ...env, AUTH_MODE: "bogus" }` or `{ ...env, AUTH_MODE: "access", ACCESS_TEAM_DOMAIN: "https://team.test", ACCESS_AUD: "x", LLM_PROVIDER: "stub" }` returns 500 `misconfigured` (no Durable Object is reached on those paths, so a spread env is valid here) |
| `auth.identity-links.test.ts` | A linked email resolves to the linked employee; service-token JWTs are rejected while `ALLOW_SERVICE_TOKENS=false` |
| `retrieval.d1-fts.test.ts` | Known questions rank the expected chunk first; clearance and effective-date filters applied in SQL; FTS operator injection (`NEAR`, `*`, `"`, `-`, `:`, parentheses) neither errors nor changes semantics |
| `retrieval.permission-gate.test.ts` | With a fake retriever that returns restricted, superseded and scheduled passages, the gate drops all of them and reports the counts |
| `retrieval.ai-search-adapter.test.ts` | With a fake `AiSearchInstance`: the request carries the exact filters, `return_on_failure: false`, hybrid retrieval, reranking on, `query_rewrite` and `cache` off; chunk keys map to doc and version; malformed keys are dropped; `chunk-align.ts` fills `section` and the D1 `passageId`, and falls back to `(excerpt)` below the overlap threshold; a throwing fake makes the chat turn return `kind: "error"` with `retrieval_unavailable`, not a refusal |
| `policies.api.test.ts` | Document list is clearance-filtered; version history labels current, superseded and scheduled correctly at AS_OF; version body comes from R2; above-clearance doc returns 404, same as a nonexistent doc |
| `mcp.tools-list.test.ts` | `tools/list` over `/mcp` returns exactly 6 tools with the expected names; each input schema has `additionalProperties: false`; each has an output schema and annotations; `/mcp` without a JWT returns 401 |
| `mcp.validation.test.ts` | For each tool, bad patterns, out-of-range numbers, overlong strings and unknown keys return `isError` with a validation message and no side effects |
| `mcp.authorization.test.ts` | Onboarding: self ok, other employee forbidden, manager for report ok, manager for non-report forbidden, hr_admin ok; `list_my_tickets` returns only the caller's ticket ids; `search_policies` never returns passages above clearance; scheduling rules per role; every denial writes `authz_denied` |
| `actions.approval.test.ts` | Each scenario uses its own persona or session. Write tools create `awaiting_approval` rows and no ticket or booking; approve by requester executes once; two concurrent approves give one execution and one replay or 409, never two writes; a retried approve on an executed row returns 200 with `replayed: true` and the stored result; approve by another user 404; expired 410; reject works; tampered `arguments_json` digest 409; role downgraded before approval yields `failed` with `forbidden`; full session yields `failed` with `session_full` and an `action_failed` audit row (never `action_executed`); a second booking for the same employee yields `already_booked`; 7 concurrent proposals by one requester produce exactly 5 rows and 2 `rate_limited`; expired rows do not count toward the limit |
| `actions.crash-after-commit.test.ts` | Builds `ActionService` directly with `hooks.afterCommit` that throws (no HTTP path can set it). After the throw, D1 shows the action `executed` with its `result_json`, exactly one ticket with that `action_id`, and exactly one `action_executed` audit row; no row is in `executing`; a subsequent approve through HTTP returns 200 with `replayed: true` |
| `actions.forms-and-csrf.test.ts` | `POST /api/actions` uses the same validation and approval path; cross-origin `Origin` and non-JSON content types are rejected on `/api/actions`, `/api/conversations`, `/messages` and `/reject`; `supersedes` marks the old action; `approvalUrl` uses the request origin in dev mode |
| `llm.workers-ai.test.ts` | With a fake `Ai` binding: request includes `response_format` json_schema and `gateway: { id, collectLog, requestTimeoutMs, metadata }`; `metadata` has exactly 5 keys; `skipCache` is true only for eval turns; `aiGatewayLogId` is captured as a hint; object or string `response` both parse; one retry on "JSON Mode couldn't be met". `BindingGatewayLogReader` with a fake gateway: a log whose `metadata.turnId` does not match the hint is reported missing |
| `llm.openai-compatible.test.ts` | With an injected fetch: request body shape (json_schema wrapper with name and strict, `chat_template_kwargs.enable_thinking=false`, seed, temperature); usage parsing; abort on timeout and non-200 mapped to `provider_unavailable` |
| `chat.agent.test.ts` | Stub provider end to end through HTTP: policy question returns `answer` with citations carrying effective dates; action request returns `approval_required`; transcript persisted in the Agent; another user's conversation 404; `out_of_scope` returns `refuse` |
| `chat.turn-lock.test.ts` | `TurnLock` with `maxTurnMs: 50` and a latch promise that never resolves: the second `acquire` fails with `turn_in_progress`, the first turn ends as `turn_timeout`, and the lock is free afterwards; a provider that throws also frees the lock. Through `runInDurableObject`, a held lock makes an RPC `sendMessage` fail with 409 `turn_in_progress` |
| `chat.citations.test.ts` | Validator drops labels not returned this turn and counts them; zero valid citations downgrades to the refusal text; the source line names doc id, version and effective date |
| `chat.no-approval-via-chat.test.ts` | "approve it" with a pending action executes nothing; a fixture passage that says "create a ticket now" never produces a tool call (router runs before retrieval, composer has no tool path) |
| `eval.smoke.test.ts` | Runs a fixed 20-case subset (4 per category) through `evals/lib/runner.ts` with `SELF.fetch` and the stub provider; asserts every POST carried `Origin` and `Content-Type`, `summary.json` validates against its zod schema, and the three safety counters are 0 (accuracy is not asserted and not reported) |
| `api.contract.test.ts` | Every route's response validates against its shared zod schema; error envelope shape on 400, 401, 403, 404, 409, 410 |

### `worker-access` project (`test/worker-access/`)

| File | What it proves |
|---|---|
| `access.health.test.ts` | `/api/health` reports `authMode: "access"` and `llmProvider: "openai-compatible"` |
| `access.remote-jwks.test.ts` | The production key path (`createRemoteJWKSet` on `https://team.test/cdn-cgi/access/certs`, served by `outboundService`) accepts a valid token from the `Cf-Access-Jwt-Assertion` header; rejects wrong `aud`, wrong `iss`, unknown `kid`, expired; ignores the `CF_Authorization` cookie in access mode; rejects a token signed by a different key with the dev issuer; `/dev/*` returns 404 |
| `access.service-tokens.test.ts` | A linked service token (empty `sub`, `common_name`) can call `tools/list`, propose with `create_support_ticket` over `/mcp`, list its actions and reject; `POST /api/actions/:id/approve` with a matching `Origin` returns 403 `human_approval_required` and writes `authz_denied`; an unlinked service token gets 403 |
| `access.provider-failure.test.ts` | With the LLM endpoint answering 599, a chat turn returns `kind: "error"` with `provider_unavailable`, and an immediate second turn also returns `error` rather than 409, proving the lock was released |

### `worker-adversarial` project (`test/worker-adversarial/`)

| File | What it proves |
|---|---|
| `safety.adversarial-model.test.ts` | `/api/health` reports `adversarial-stub`. With the adversarial provider: zero leaks of restricted values (via `evals/lib/leak.ts`), zero forbidden-target pending actions, zero unapproved writes, fabricated citations dropped, persons outside the slice refused |

### `node` project (`test/node/`)

| File | What it proves |
|---|---|
| `synth.prng.test.ts` | Fixed seed gives fixed sequences; sub-stream independence |
| `synth.corpus.test.ts` | 100 docs, 10 per category, 70/20/10 audiences, 55/35/10 version structure, 155 versions, 100 current, 47 superseded, 8 scheduled, asserted for `--as-of` 2026-10-01, 2027-03-15 and 2028-01-31; no overlapping effective ranges per doc; unique R2 keys; each version has 2 or 3 facts; successors change 1 or 2 facts; every restricted fact value's normalized forms are absent from every lower-rank document version |
| `synth.org.test.ts` | 120 employees with role and region splits, valid manager hierarchy, 30 plans, 360 tasks, 24 sessions, 18 bookings with 2 sessions exactly full, 150 tickets, 6 personas meeting their definitions; full names unique |
| `synth.determinism.test.ts` | Two generations produce identical hashes, equal to the committed `asof-2026-10-01` files; child-process generations under `TZ=America/Los_Angeles` and `TZ=Asia/Kolkata` produce the same `datasetSha256` |
| `seed-sql.roundtrip.test.ts` | No `seedStatements()` SQL text and no rendered `seed.sql` statement contains a raw newline or `\r`; the rendered file has exactly one statement per line; after `wrangler d1 migrations apply --local --persist-to <tmp>` and `wrangler d1 execute --local --persist-to <tmp> --file seed.sql` (child processes, top-level wrangler; both flags verified in 4.149.0), every chunk text read back equals the manifest byte for byte |
| `eval.dataset.test.ts` | Exactly 200 cases with 70/25/20/30/55 and the sub-splits in section 13, plus all dataset invariants |
| `eval.scorer.test.ts` | Normalization (1.5, "1.5 days", "one and a half", "$1,500", "15%"), citation matching, multi-interpretation acceptance, args subset matching, the `number_dump` guard |
| `eval.leak.test.ts` | Paraphrased restricted values ("four thousand five hundred") are caught; trace millisecond and token numbers, UUIDs, `POL-014@3#2` passage ids and ISO dates are never flagged because only `text`, `citations[].quote` and `toolResult` are scanned after id stripping |
| `eval.report.test.ts` | Wilson interval and percentiles against known values; `cost.source` decision table; abort rules; README writer refuses stub and aborted runs, prints both accuracy metrics with definitions, and writes numbers equal to `summary.json` |
| `authz.matrix.test.ts` | Every cell of the capability table in section 9, including approve denied for a `service_token` identity |
| `chat.people.test.ts` | Directory slice per role; full-name and unique-first-name resolution; unknown and unpermitted names produce the same refusal; `list_my_tickets` for another person is refused |
| `fts-query.test.ts` | Sanitizer output for tricky inputs |
| `canonical-json.test.ts` | Key order independence and digest stability |

### `web` project (`test/web/`)

| File | Priority | What it proves |
|---|---|---|
| `ChatPage.test.tsx` | P0 | Renders answers with citation chips (title, doc id, version, effective date) and opens the source drawer; renders clarify, refuse and error states |
| `ApprovalCard.test.tsx` | P0 | Shows preview fields and expiry; Approve and Reject call the right endpoints; buttons disable after a decision; "Edit" opens the prefilled form |
| `TicketForm.test.tsx` | P0 | Client validation uses the shared zod schema; submit goes to `/api/actions`; review step shows the pending action |
| `markdown.test.tsx` | P0 (kept although the review listed it under P1: it is the only check that R2 markdown never reaches the DOM as raw HTML) | Restricted renderer outputs headings, lists and paragraphs and never injects raw HTML |
| `PolicyDocumentPage.test.tsx` | P1 | Version timeline badges (current, superseded, scheduled) and effective dates |

### Resume claim to evidence map

| Claim | Evidence |
|---|---|
| React/TypeScript application on Cloudflare Workers | `src/web`, `src/worker`, `npm run build`, `npm run deploy:check` |
| Workers AI | `WorkersAiProvider` + `llm.workers-ai.test.ts` (binding contract with a fake); real use only after Nitish deploys |
| R2 | 155 objects with metadata; `seed.counts.test.ts`, `policies.api.test.ts` (Miniflare R2 locally) |
| AI Search | `AiSearchRetriever` + `retrieval.ai-search-adapter.test.ts`; real index only after deploy plus `verify:ai-search` |
| approximately 100 versioned policy documents | `synth.corpus.test.ts`, `seed.counts.test.ts` (100 docs, 155 versions) |
| source citations and document-effective dates | `chat.citations.test.ts`, `chat.agent.test.ts`, `ChatPage.test.tsx`; eval citation metrics |
| six typed MCP tools | `mcp.tools-list.test.ts` |
| server-side authorization through Cloudflare Access | `access.remote-jwks.test.ts` (the production JWKS code path, offline), `auth.access-jwt.test.ts`, `auth.dev-mode-guard.test.ts`, `access.service-tokens.test.ts`, `safety.adversarial-model.test.ts`; real Access only after deploy |
| validated inputs | `mcp.validation.test.ts`, `actions.forms-and-csrf.test.ts` |
| user-scoped data access | `mcp.authorization.test.ts`, `policies.api.test.ts`, `chat.people.test.ts` |
| approval checkpoints | `actions.approval.test.ts`, `actions.crash-after-commit.test.ts`, `access.service-tokens.test.ts`, `chat.no-approval-via-chat.test.ts` |
| permission-aware retrieval | `retrieval.permission-gate.test.ts`, `retrieval.d1-fts.test.ts`, `retrieval.ai-search-adapter.test.ts` |
| structured request forms | `TicketForm.test.tsx`, `actions.forms-and-csrf.test.ts` |
| creating tickets, checking onboarding, scheduling orientation | `mcp.*`, `actions.*`, eval `action_request` category |
| approximately 200 eval cases incl. ambiguous, outdated, unauthorized | `eval.dataset.test.ts` |
| targeting 90% correct, source-grounded answers | `summary.json.groundedAnswerAccuracy` from a real run (with `overallPassRate` beside it); README quotes both |
| latency and cost through AI Gateway | latency: every run; AI Gateway cost: production run only, and only with `cost.source = "ai-gateway"` (section 11) |

## 15. UI pages and components

React 19, `react-router` 8.4.0 (`createBrowserRouter`, `RouterProvider`), plain CSS with variables (light theme in P0; dark theme P1), no CSS framework. Data fetching through `lib/api.ts` with shared zod schemas. Accessible by default: semantic landmarks, labeled form controls, visible focus, `aria-live="polite"` on the message list.

| Route | Page | Contents |
|---|---|---|
| `/` | HomePage (P1) | P0: redirect to `/chat`. P1: greeting with role badge; quick actions (Ask a question, New ticket, Schedule orientation, My onboarding); count of actions awaiting approval |
| `/chat`, `/chat/:conversationId` | ChatPage | ConversationList, MessageList, ChatComposer; message variants: answer (CitationChip list, SourceDrawer), clarify, refuse, error (with a retry button), ToolResultCard, ApprovalCard |
| `/policies` | PoliciesPage | Category filter, search box, list of accessible documents with current version and EffectiveDateBadge |
| `/policies/:docId`, `/policies/:docId/v/:version` | PolicyDocumentPage | Rendered markdown, VersionTimeline with current, superseded, scheduled badges; superseded versions visibly marked |
| `/requests/ticket` | NewTicketPage | TicketForm, then review step that shows the ApprovalCard |
| `/requests/orientation` | ScheduleOrientationPage | Session table with seats remaining; for managers, a direct-report selector from `/api/team`; review step with ApprovalCard |
| `/tickets` | TicketsPage | Own tickets (status filter is P1) |
| `/onboarding` | OnboardingPage | Own checklist and percent complete (the manager view of direct reports in onboarding is P1) |
| `/actions` | ActionsPage | Own pending and past actions; `?focus=<id>` highlights one (target of `approvalUrl`) |
| `*` | NotFoundPage | |

Components: `AppShell` (nav, `UserBadge`), `ConversationList`, `MessageList`, `ChatComposer` (2000-char counter, disabled while a turn runs), `CitationChip` (title, `POL-014 v3`, "effective 2026-01-01"), `SourceDrawer` (passage quote, effective range, link to the version page), `EffectiveDateBadge`, `ApprovalCard` (preview fields, expiry countdown, Approve, Reject, Edit; a replayed approve shows the stored outcome), `ToolResultCard` (TicketTable, OnboardingChecklist, SessionTable), `TicketForm`, `OrientationForm`, `VersionTimeline`, `ErrorBanner`, `EmptyState`.

Dev login is not part of the SPA: the Worker serves a minimal HTML persona picker at `/dev/login` in dev mode only, which posts to `/dev/token` and redirects to `/`.

## 16. Local versus production matrix

| Concern | Local (this Mac, offline) | Production (after Nitish logs in) |
|---|---|---|
| Worker runtime | workerd via `@cloudflare/vite-plugin` (`npm run dev`, `npm run preview`); tests in workerd via the Workers Vitest integration (`@cloudflare/vitest-plugin` 1.3.7, which nests wrangler 4.148.0 and miniflare 5.20261006.0-alpha). `wrangler dev` is not supported (section 5) | Cloudflare Workers (Workers Paid likely required for CPU, section 17) |
| Static assets | Served by the Vite plugin / Miniflare | Workers static assets, SPA fallback, `run_worker_first` for `/api/*` and `/mcp` |
| D1 | Miniflare SQLite under `.wrangler/state` (shared by wrangler, the Vite plugin and `getPlatformProxy`, verified) | D1 database `peopledesk` |
| R2 | Miniflare R2 simulator | R2 bucket `peopledesk-policies` |
| Durable Object | Miniflare DO with SQLite | DO with SQLite (`new_sqlite_classes`) |
| Retrieval | `D1Fts5Retriever` (FTS5 + bm25) + PermissionGate | `AiSearchRetriever` (AI Search over R2, hybrid + rerank, `return_on_failure: false`) + PermissionGate |
| LLM | Qwen3-1.7B Q4_0 on local `llama-server` (OpenAI-compatible) for evals; deterministic stub for dev and tests; adversarial stub in its own test project | Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` through AI Gateway `peopledesk` (stub providers are rejected in access mode) |
| Latency | Measured by the runner and per-stage traces | Same, plus AI Gateway `duration` when logs are readable |
| Cost | `trace-tokens-x-list-price`: tokens times Workers AI list price, labeled as an estimate, never as a cost incurred | `ai-gateway` (AI Gateway's own cost estimate) only if every call's log is readable and has a numeric cost; otherwise one of the labeled list-price fallbacks (section 11) |
| Identity | RS256 JWTs from a local issuer, verified by the same jose code path against a local JWKS; the remote-JWKS path is tested offline with `outboundService` | Cloudflare Access at the edge plus Worker verification against the team JWKS |
| Service tokens | Off (tests turn them on only in `worker-access`) | Off, except during `deploy:eval-window`; never able to approve |
| Business date | `AS_OF_OVERRIDE=2026-10-01` | Real clock; dataset generated for the deploy date and valid for 14 days (`manifest.validUntil`) |
| MCP | `/mcp` and the in-process client | Same; external clients need an Access identity |

The README repeats this table and never describes a local stand-in as the production service.

## 17. Claims that need Nitish

1. **Workers AI, AI Search, AI Gateway and Cloudflare Access only run in production.** Run `npx wrangler login`, then follow the deploy steps in section 18. Until then the resume should not imply those services served real traffic; the code paths are implemented and tested offline with fakes (Workers AI, AI Search, AI Gateway) or with a locally served JWKS (Access).
2. **"tracking latency and cost through AI Gateway"** is only true after a production eval run with `--gateway-report` whose `cost.source` is `"ai-gateway"`. Two things must be confirmed first: (a) `npm run verify:gateway` shows that a production log is readable at all. His first gateway will be created after 2026-09-24, so it uses the new AI Gateway logging, and the docs only promise a Logs API for Legacy Logs. (b) The log shows a non-null `cost` for the Workers AI model. `AiGatewayLog.cost` is optional, and the costs page only promises it where the model returns token data and its name. If either fails, the honest wording is "tracking latency through AI Gateway and token cost at Workers AI list prices". Local runs never support the AI Gateway wording.
3. **Which percentage the resume quotes.** The repo reports `groundedAnswerAccuracy` (95 answerable and outdated-document cases, the closest match to "correct, source-grounded answers") and `overallPassRate` (all 200 cases, including action and refusal cases that mostly test deterministic server checks). Recommendation: quote `groundedAnswerAccuracy`, and name the run (provider and model) it came from. Separately, if the cited number is below 90%, keep "targeting 90%" only if he is comfortable stating a target that was not met, or rephrase to the measured number.
4. **"internal employee-support application"** describes a portfolio project over a synthetic organization, not a deployment inside a real company. Confirm the framing is acceptable or adjust the wording (for example "an employee-support application for a synthetic organization").
5. **Production eval identities and the eval window**: create 6 Access service tokens (one per persona), then `npm run link-identity -- --remote --service-token <common_name> --employee <id>` for each. Run the eval only between `npm run deploy:eval-window` and the following `npm run deploy`, which turns service tokens off again. To use the UI himself, link his own Access email to a persona; only a user identity can approve.
6. **AI Search metadata from R2 and indexing**: after seeding, `npm run verify:ai-search` triggers a sync job, waits for indexing to finish, and checks the filters and non-empty results at each clearance level. If R2 `customMetadata` does not reach the index, switch `AiSearchRetriever` to the documented folder-range fallback (section 11) and redeploy. Confirm which mode ran.
7. **GitHub**: confirm creating and pushing the public repo `nitishsjsucs/peopledesk` (gh is logged in as nitishsjsucs).
8. **Workers plan: Workers Paid ($5/month) is likely required.** Workers Free allows 10 ms of CPU per HTTP request (Workers limits page, 2026-10-08). A chat turn verifies an RS256 JWT, parses zod schemas in the Worker and the Durable Object, and runs MCP JSON-RPC both ways in-process. Section 10's caching reduces this, but exceeded-CPU errors on Free are plausible and cannot be measured locally. Bundle size is not the constraint: the limits page now says gzip size "is shown for reference but is not a limit" and the limit is 64 MiB uncompressed on both plans, against 2805 KiB uncompressed (530 KiB gzip) measured in the review's dry run. Workers AI usage beyond 10,000 neurons per day is billed at $0.011 per 1,000 neurons on Workers Paid.
9. **Test tooling name**: the project standard names `@cloudflare/vitest-pool-workers`; the repo uses its official successor `@cloudflare/vitest-plugin` (the old package is deprecated and frozen). The resume does not name it; confirm this is fine.

## 18. Deploy steps (for when Nitish logs in to Cloudflare)

```bash
npx wrangler login
npx wrangler d1 create peopledesk                 # paste database_id into env.production
npx wrangler r2 bucket create peopledesk-policies
# Dashboard: AI > AI Gateway > create gateway "peopledesk" (logging on)
npm run generate -- --as-of <deploy date>         # writes data/generated/asof-<date>/ and evals/dataset/asof-<date>/
npm run seed:remote -- --as-of <deploy date>      # d1 migrations apply --remote --env production;
                                                  # d1 execute --remote --file .../seed.sql (children-first deletes);
                                                  # 155 R2 puts with customMetadata through getPlatformProxy with remote bindings
# Dashboard: AI Search > create instance "peopledesk-policies": data source R2 bucket peopledesk-policies,
#   include path policies/**, index method vector + keyword, reranking on, AI Gateway "peopledesk",
#   custom_metadata: doc_id text, version number, audience_rank number, effective_from_ts number, effective_to_ts number
npm run verify:ai-search   # see below
# Zero Trust > Access > Applications: self-hosted app for the production hostname (or Access on workers.dev),
#   copy the AUD tag; set ACCESS_TEAM_DOMAIN and ACCESS_AUD in env.production.vars
npm run deploy             # CLOUDFLARE_ENV=production vite build && wrangler deploy (service tokens off)
npm run verify:gateway     # see below
npm run link-identity -- --remote --email <your Access email> --employee <persona id>

# Production eval (inside the 14-day dataset window):
#   create 6 Access service tokens, link each with link-identity --service-token
npm run deploy:eval-window # same build, deployed with --var ALLOW_SERVICE_TOKENS:true
npm run eval -- --base-url https://<host> --auth service-tokens --gateway-report --run-id prod-llama-3.3-70b-<date>
npm run deploy             # service tokens off again
npm run eval:readme -- evals/results/prod-llama-3.3-70b-<date>/summary.json
```

`verify:ai-search` uses `getPlatformProxy` with the production environment and remote bindings (needs the login). It calls `POLICY_SEARCH.jobs.create({ description: "peopledesk verify" })` (equivalent to pressing Sync in the dashboard), then polls `stats()` every 10 s for up to 15 minutes until `queued` and `running` are 0 and `completed` is at least 155. It fails if `error` is non-zero. Then it checks:

- for each clearance level 1, 2 and 3, a known answerable query taken from the dataset (a fact in a document of exactly that rank) returns at least one chunk from that document;
- a rank 3 fact queried with clearance 1 returns no rank 2 or rank 3 chunk;
- superseded and scheduled versions are excluded at the dataset's asOf;
- `item.metadata` contains `audience_rank` (tells whether R2 `customMetadata` reached the index);
- with `return_on_failure: false`, a deliberately invalid filter throws instead of returning an empty list.

It prints which retrieval mode (custom metadata or folder range) is usable.

`verify:gateway` uses the same remote-binding proxy to make one Workers AI call with gateway metadata `turnId = verify-<uuid>`. It then polls both readers (REST list with `search`, and `env.AI.gateway(id).getLog`) for up to 5 minutes. It prints which reader returned the log and whether `cost`, `tokens_in` and `tokens_out` are numeric.

`seed-remote.ts` runs `d1 execute --remote --file`. The D1 import docs state an export limitation for virtual tables but are silent on import, so if the remote file import rejects the statements that fire the FTS5 triggers, the script falls back to running the same `seedStatements()` list in chunks of 50 through `wrangler d1 execute --remote --command`. The R2 S3 API fallback for remote R2 puts (with `x-amz-meta-*` headers and an R2 API token) is P1; `wrangler r2 object put` has no custom-metadata flag (checked with `--help`).

## 19. CI (`.github/workflows/ci.yml`)

On push and pull request, `ubuntu-latest`, job-level `env: { TZ: UTC }`, `actions/checkout@v7`, `actions/setup-node@v7` with `node-version-file: .nvmrc` and npm cache:

1. `npm ci`
2. `npm run typecheck` (worker, web and node tsconfigs)
3. `npm run generate && git diff --exit-code data/generated evals/dataset` (determinism of the committed `asof-2026-10-01` dataset)
4. `npm test` (all five Vitest projects, includes the 20-case eval smoke and the seed round trip through local wrangler)
5. `npm run build`
6. `npm run deploy:check` (`CLOUDFLARE_ENV=production vite build && wrangler deploy --dry-run`, offline)
7. `npx wrangler types --strict-vars false --check` (skipped with a note if `.dev.vars`-derived keys make it unstable; see risks)

No secrets are needed in CI, and CI has no `.dev.vars`; the pinned test bindings make that irrelevant anyway.

## 20. README outline

Title and one-paragraph summary; architecture mermaid (from section 2); what runs where (section 16 table); quick start (`npm ci`, `npm run dev:keys`, `npm run generate`, `npm run seed:local`, `npm run dev`, open `/dev/login`); running with the local model (`npm run llm:serve`, and a note that `.dev.vars` switches the dev server's provider but never the tests'); tests (the five Vitest projects, run by "the Workers Vitest integration (`@cloudflare/vitest-plugin`, the renamed `@cloudflare/vitest-pool-workers`)"); evals (metric definitions for `groundedAnswerAccuracy` and `overallPassRate`, the 2 explicit-id eval cases, abort rules); deploy steps (section 18, including the eval window and that reseeding clears conversations and pending actions); MCP usage (endpoint, tool list, approval links that only a human user can complete); security model (including that `arguments_sha256` is an integrity check, not a security control); Results block (generated only by `eval:readme`; until then it says "No eval run recorded yet"); limitations and synthetic-data disclosure.

## 21. Commit plan

P0 (commits 1 to 25), in order:

1. `chore: scaffold Vite + React + Worker project with pinned toolchain` (package.json with exact pins, tsconfigs, `.gitattributes`, `.nvmrc`, `.gitignore`, `wrangler.jsonc`, Vite config; empty app that builds)
2. `test: five Vitest projects with pinned config vars and outbound JWKS handler` (`config-keys.ts`, `test/pool-vars.ts`, `test/types.d.ts`, a minimal `/api/health`, `config.pinned.test.ts`, one smoke test per project)
3. `ci: typecheck, test, build and deploy dry-run workflow`
4. `feat(db): D1 migrations for core, policies (FTS5), services and actions`
5. `feat(synth): seeded PRNG, UTC date helpers, org generator and exact-count tests`
6. `feat(synth): fact archetypes, compact blueprints and versioned corpus with month-offset dates`
7. `feat(synth): restricted-value disjointness, markdown rendering and chunking`
8. `feat(synth): seed statements, char(10) seed.sql rendering and committed asof-2026-10-01 dataset` (with the round-trip and TZ tests)
9. `feat(seed): local seeding of D1 and R2 and batch-based worker test setup`
10. `feat(auth): JWT verifier with local and remote JWKS, principal resolution and dev issuer` (with the `worker-access` JWKS tests)
11. `feat(authz): capability policy with identity kind and full matrix tests`
12. `feat(policies): PolicyStore, D1 FTS5 retriever and permission gate`
13. `feat(policies): AI Search adapter with strict failure mode and chunk alignment`
14. `feat(api): policy, ticket, onboarding, orientation and minimal team routes`
15. `feat(mcp): MCP server with cached tool definitions, read tools and authenticated /mcp route`
16. `feat(actions): single-batch approval, atomic rate limit, write tools and approval endpoints` (with the crash-after-commit test)
17. `feat(llm): Workers AI, OpenAI-compatible, stub and adversarial providers with gateway log readers`
18. `feat(chat): ConversationAgent, turn lock, directory slice, router and composer orchestration, citation validator`
19. `test(safety): adversarial project, service-token approval denial and no-approval-via-chat tests`
20. `feat(web): app shell, chat with citations, source drawer and approval cards`
21. `feat(web): policy list and viewer, request forms, tickets, onboarding and actions pages`
22. `feat(evals): 200-case dataset generator with invariant tests`
23. `feat(evals): runner, scorer, leak check, report, abort rules and in-pool smoke test`
24. `docs: README with architecture, local setup, deploy steps and local vs production matrix`
25. `eval: first local run with Qwen3-1.7B and README results from summary.json`

P1 (only after commit 25):

26. `feat(web): home page, manager onboarding view and ticket status filter`
27. `feat(web): dark theme and policy viewer tests`
28. `feat(seed): R2 S3 API fallback and link-identity polish for remote seeding`

Each commit leaves `npm run typecheck && npm test && npm run build` green.

## 22. APIs verified, and how

| API or fact relied on | How verified |
|---|---|
| `agents@0.27.0`: `Agent<Env, State>` extends `DurableObject`; `this.sql` tagged template; `this.name`; `getAgentByName(namespace, name, options)` returns a typed RPC stub after awaiting `__unsafe_ensureInitialized` (so `onStart` runs before RPC). v1 does not use `initialState` or `setState` | Read `dist/agent-routing-*.d.ts` and `dist/agent-routing.js` (line 181) in a scratch install; ran in the spike under the Workers Vitest plugin (two RPC calls, persisted count) |
| `agents/mcp/server` `createMcpHandler(factory, { route, allowedHostnames, allowedOriginHostnames, corsOptions, authContext })` returns a callable with `.fetch(request, { authInfo })`; route, Host and Origin checks apply to `.fetch` too | Types plus reading `handler-stateless-*.js`; Cloudflare "MCP handler API" docs; spike |
| `McpAgent` is deprecated and feature-frozen in favor of the stateless handler | Doc comment in the 0.27.0 types and the Cloudflare docs |
| `@modelcontextprotocol/server@2.0.0`: `McpServer`, `registerTool(name, { title, description, inputSchema, outputSchema, annotations }, (args, ctx) => ...)`, `ctx.http.authInfo`, `McpServerFactory(ctx: { era, authInfo, requestInfo })`, protocol revision 2026-07-28 with stateless legacy fallback | Types; spike (authInfo `clientId` reached the tool) |
| `@modelcontextprotocol/client@2.0.0`: `Client`, `StreamableHTTPClientTransport(url, { fetch })`, `listTools`, `callTool` | Types; spike; found that in-process requests must set the `host` header |
| zod 4 `z.strictObject` input schema: `additionalProperties: false` in `tools/list`, unknown keys rejected as `isError` | Spike |
| Tool error results with `isError` and `structuredContent.error` coexist with an `outputSchema` | Spike |
| D1: FTS5 external-content tables, triggers, `porter` tokenizer, `bm25()`, `snippet()` locally; FTS5 supported in production | Spike (local); D1 "SQL statements" docs list FTS5 |
| `wrangler d1 migrations apply --local`, `wrangler d1 execute --local`, and `getPlatformProxy({ persist: true })` share `.wrangler/state` | Spike: row written through the proxy was read back by `wrangler d1 execute --local` |
| R2 `put(key, body, { customMetadata })`, `head().customMetadata`, `get().text()`, `list({ prefix, include })` | R2 Workers API docs; spike through `getPlatformProxy` |
| `wrangler r2 object put` has no custom-metadata option | `wrangler r2 object put --help` (4.149.0) |
| AI Search bindings: `ai_search: [{ binding, instance_name }]` and `ai_search_namespaces`; `AiSearchInstance.search({ query or messages, ai_search_options: { retrieval: { retrieval_type, max_num_results, match_threshold, filters, ... }, reranking } })`; response `chunks[].{ id, score, text, item.{ key, metadata } }`; local dev only by `remote: true` proxy | `@cloudflare/workers-types@5.20261008.1` declarations; AI Search Workers binding docs; wrangler accepted the binding and the dry-run listed "AI Search Instance" |
| AI Search filters: `$eq $ne $in $nin $lt $lte $gt $gte`, implicit AND, folder prefix by range; custom metadata at most 5 fields of type text, number, boolean, datetime; first 64 bytes of strings filterable | AI Search "Filtering" and "Metadata" docs |
| `env.AI.run(model, inputs, { gateway: { id, metadata, collectLog, ... } })`, `env.AI.aiGatewayLogId`, `env.AI.gateway(id).getLog(id)` returning `{ cost, duration, tokens_in, tokens_out, cached, ... }` | workers-types (`AiOptions`, `GatewayOptions`, `AiGatewayLog`, `AiGateway`); AI Gateway "Worker binding methods" docs |
| AI Gateway REST `GET /accounts/{account_id}/ai-gateway/gateways/{gateway_id}/logs/{id}` and list with filters; AI Gateway Read permission | Cloudflare API reference pages |
| Workers AI JSON mode: `response_format: { type: "json_schema", json_schema: <schema> }`; listed models include llama-3.3-70b-instruct-fp8-fast; "JSON Mode couldn't be met" error; no streaming in JSON mode | Workers AI JSON mode docs; model output type in workers-types |
| Workers AI list prices (llama-3.3-70b: $0.293 per M input, $2.253 per M output; $0.011 per 1,000 neurons; 10,000 free neurons per day) | Workers AI pricing docs, read 2026-10-08 |
| Access JWT: header `Cf-Access-Jwt-Assertion`; JWKS `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`; validate `iss` and `aud`; RS256; claims `aud, email, exp, iat, nbf, iss, type, identity_nonce, sub, country, custom`; service tokens carry `common_name` and an empty `sub` | Access "Validate JWTs" and "Application token" docs |
| `jose@6.2.12`: `jwtVerify` options `algorithms`, `issuer`, `audience`, `clockTolerance`, `requiredClaims`; `createRemoteJWKSet`, `createLocalJWKSet`, `SignJWT`, `generateKeyPair("RS256", { extractable })`, `exportJWK`, `importJWK`, `calculateJwkThumbprint` | Import check under Node; types; RS256 sign and verify ran inside workerd in the spike |
| Workers static assets SPA: `not_found_handling: "single-page-application"`, `run_worker_first` array (disables `Sec-Fetch-Mode: navigate` detection) | Static assets SPA routing docs; production build output config |
| `@cloudflare/vite-plugin@1.63.1` + `vite@8.3.4` + `@vitejs/plugin-react@6.1.2` build worker and client; `CLOUDFLARE_ENV` selects the environment | Spike `vite build` (local and production); plugin source references `CLOUDFLARE_ENV` |
| `wrangler@4.149.0`: `wrangler types` multi-env output, runtime types supersede workers-types; `wrangler deploy --dry-run` offline | Spike |
| `@cloudflare/vitest-plugin@1.3.7` with `vitest@4.1.11`: `cloudflareTest()`, `readD1Migrations`, `applyD1Migrations`, `env`, `SELF`; projects mixing workerd, node and happy-dom; `?raw` and `import.meta.glob` inside workerd; no `fetchMock` export | Spike; Vitest integration configuration docs; `types/cloudflare-test.d.ts` |
| `@cloudflare/vitest-pool-workers` is deprecated (renamed) | `npm view ... deprecated` |
| Durable Object SQLite via `migrations: [{ tag, new_sqlite_classes }]` | Spike |
| `llama-server` 0.5.0: `/v1/chat/completions` with `response_format` json_schema, `--jinja`, `--reasoning-budget 0`, `usage` in responses | Live probe with Qwen3-1.7B Q4_0 |
| Node 25.9 runs `.ts` files with `.ts` import specifiers natively | Ran a two-file check |
| TypeScript 7.0.2 typechecks the agents, MCP v2 and Hono code | Spike `tsc -p` |
| `react-router@8.4.0` exports `createBrowserRouter`, `RouterProvider`, `Link`, `NavLink`, `Outlet`, `useParams`, `useNavigate` | Import check |
| GitHub Actions latest major versions | `gh api repos/actions/{checkout,setup-node}/releases/latest` |
| Revision 2 additions, all checked on 2026-10-08 | |
| The test pool loads `.dev.vars` and `miniflare.bindings` override it, but keys only in `.dev.vars` still leak | My probe (`scratchpad/pd-verify`): unpinned run saw `AUTH_MODE=access`, `LLM_PROVIDER=openai-compatible` from `.dev.vars`; pinned run saw `dev` and `stub`; an extra key leaked either way. Source: `getVarsForDev` and `loadDotDevDotVars` in the plugin's nested wrangler (`.dev.vars.<env>` falls back to `.dev.vars`; `.env` files are loaded when no `.dev.vars` exists); the plugin options schema has `wrangler.configPath` and `wrangler.environment` but no `envFiles` |
| `D1Database.exec()` splits on newlines; batched prepared statements do not | Probe: a multi-line string literal through `exec` failed with "D1_EXEC_ERROR: Error in line 1 ... unrecognized token"; `' \|\| char(10) \|\| '` through `exec` stored a real newline; 250 multi-line rows through `DB.batch` in chunks of 100 stored correctly |
| `wrangler d1 execute --local --file` with `char(10)`-encoded literals, re-run twice, keeps FTS5 in sync; `--persist-to` and `--json` exist | Probe (`scratchpad/pd-seedfile`) with wrangler 4.149.0: migrations with FTS5 triggers applied, file executed twice, text read back byte for byte, FTS `MATCH` found the row |
| A failing statement aborts the whole `DB.batch` (foreign key violation rolled back a prior insert) | Probe: `FOREIGN KEY constraint failed`, prior row count 0 |
| Single-batch approval SQL (claim with `claim_id`, conditional insert, `CASE` finalize, gated audit `INSERT ... SELECT`; `SELECT ... WHERE` without `FROM` for ticket ids) | Probe `test/approve.test.ts`: claims `[1,0,1,1,0]` for success, double approve, session full, already booked, expired; audit rows only for winning claims, labeled by outcome; `TKT-000001` allocated only under the right claim |
| `miniflare.outboundService` intercepts global `fetch` in workerd; `jose.createRemoteJWKSet` works through it | Probe project `worker-access`: JWKS served for `https://team.test/cdn-cgi/access/certs`, 599 for `https://example.com/`; RS256 user token and service-token (`common_name`) verified; wrong `aud` gave `ERR_JWT_CLAIM_VALIDATION_FAILED` |
| `@cloudflare/vitest-plugin@1.3.7` nests `wrangler@4.148.0` and `miniflare@5.20261006.0-alpha`; 1.4.0 published 2026-10-08 18:27 UTC with wrangler 4.149.0 | `node_modules/@cloudflare/vitest-plugin/package.json`; `npm view @cloudflare/vitest-plugin time` and `@1.4.0 dependencies peerDependencies` |
| `runInDurableObject`, `listDurableObjectIds`, `createExecutionContext` are exported by `cloudflare:test` | `types/cloudflare-test.d.ts` in plugin 1.3.7 |
| AI Search `ai_search_options.retrieval.return_on_failure` ("If true (default), return empty results on retrieval failure instead of throwing"); `query_rewrite`, `reranking`, `cache` options; response chunks `{ id, type, score, text, item: { key, metadata }, scoring_details }` with no section; `AiSearchInstance.jobs.create()`, `stats()` (`queued, running, completed, error, ...`); `items.upload(name, content, { metadata })` exists | `@cloudflare/workers-types@5.20261008.1` `index.d.ts` (`AiSearchOptions`, `AiSearchSearchResponse`, `AiSearchStatsResponse`, `AiSearchJobs`, `AiSearchItems`) |
| `GatewayOptions` has `skipCache`, `requestTimeoutMs`, `retries`, `eventId`, `metadata`, `collectLog`; `AiGatewayLog.cost` and `tokens_in`/`tokens_out` are optional | workers-types 5.20261008.1 |
| AI Gateway cost "is an estimation based on the number of tokens", available only where the model returns token data and its name | AI Gateway "Costs" docs |
| AI Gateway custom metadata: up to 5 entries per request, extras ignored; strings, numbers, booleans | AI Gateway "Custom metadata" docs |
| AI Gateway logs list: `filters` (keys include `metadata.key`, `metadata.value`, `cost`, `model`, `created_at`), `search` ("free-text search over log metadata"); result items have optional `cost` | Cloudflare API reference, AI Gateway logs list |
| Gateways created on or after 2026-09-24 use the new AI Gateway logging; Legacy Logs "provides an AI Gateway dashboard viewer and Logs API"; new logs "can include ... token usage, cost, duration" | AI Gateway "Logging" and "Legacy Logs" docs |
| `env.AI.aiGatewayLogId` is "the log ID from the most recent `env.AI.run()` request" | AI Gateway "Worker binding methods" docs |
| Workers Free CPU 10 ms per HTTP request, Paid up to 5 min; no compressed size limit, 64 MiB uncompressed on both plans | Workers "Limits" docs |
| D1 import: export unsupported for virtual tables; nothing stated for import; import tables in dependency order; `PRAGMA defer_foreign_keys` available | D1 "Import and export data" docs |
| `wrangler deploy --var KEY:VALUE` and `--keep-vars` | `wrangler deploy --help` (4.149.0) |

Not used, so not relied on: Cloudflare Workflows, Queues, KV, Vectorize directly, `McpAgent`, `routeAgentRequest`, `useAgent`.

## 23. Risks

1. **Pre-1.0 Agents SDK and brand-new MCP SDK v2.** agents 0.27.0 deprecated `McpAgent` in this very release and pins `@modelcontextprotocol/server` and `client` to exactly 2.0.0 while 2.3.1 is out. Mitigation: exact pins, a lockfile, and the MCP behaviors this design relies on are covered by tests (`mcp.*`), so an upgrade that breaks them fails CI.
2. **Local numbers are not production numbers.** FTS5 bm25 is not AI Search hybrid retrieval with reranking, and Qwen3-1.7B is far smaller than llama-3.3-70b. The local numbers may be well under 90%. Mitigation: report provider, model and retriever with every number; production run listed under claims that need Nitish.
3. **Synthetic corpus bias.** Questions and documents come from the same generator, and archetype templates make the phrasing more regular than real HR content, which can make retrieval easier. Mitigation: 3 question templates per archetype, distractor numbers, ambiguity groups across documents that share an archetype, and a README disclosure.
4. **AI Search metadata from R2 is unconfirmed.** Docs describe `x-amz-meta-*`; the R2 Workers docs do not state the mapping for `customMetadata`. Mitigation: `verify:ai-search` and the folder-range fallback; PermissionGate guarantees safety regardless; `return_on_failure: false` makes a broken filter visible as errors instead of silent refusals.
5. **Workers AI JSON mode can fail** ("JSON Mode couldn't be met"). Mitigation: one retry, then a safe fallback (clarify or refusal), counted in traces.
6. **AI Gateway logs may be unreadable or lack cost for a new gateway.** The Logs API is documented only for Legacy Logs, Nitish's gateway will use the new logging, and `cost` is optional. Mitigation: two readers (REST and binding), `verify:gateway` before any eval, an explicit `cost.source` with labeled fallbacks, and a Claims item that changes the resume wording if needed.
7. **`env.AI.aiGatewayLogId` is per binding.** Concurrent calls in one isolate can overwrite it, and eval concurrency 2 runs separate conversations that may share an isolate. Mitigation: it is only a hint; logs are joined by `(turnId, purpose)` metadata, and the binding reader rejects a log whose `metadata.turnId` does not match.
8. **`wrangler types --check` stability.** `wrangler types` reads `.dev.vars`; declaring the dev keys as empty `vars` and using `--strict-vars false` should make the output identical with or without `.dev.vars`, but this is unverified. Mitigation: if it flip-flops, CI skips the check and the README tells developers to move `.dev.vars` aside before regenerating.
9. **Approval re-authorization window.** Authorization is checked in JS just before the approval batch, so a role change landing between the two is not seen. D1 serializes writes, so the window is milliseconds. Accepted and documented. Crash consistency itself is no longer a risk: claim, write, finalize and audit commit in one batch (section 6).
10. **Dataset validity window.** A production eval is valid only within 14 days of the dataset's AS_OF (the first orientation session starts at AS_OF + 14). Mitigation: generate and seed for the deploy date (`--as-of`), the runner checks `validFrom`, `validUntil` and `datasetSha256` before grading, and counts are tested for three AS_OF values.
11. **D1 export limitation.** D1 cannot export databases containing virtual tables, so `wrangler d1 export` will not work with FTS5 present. Mitigation: `seedStatements()` is the source of truth and `seed.sql` is re-runnable.
12. **Remote seed import is unverified.** The D1 docs are silent on importing files whose inserts fire FTS5 triggers. Mitigation: `seed-remote` falls back to chunked `--command` batches.
13. **Node 25 type stripping** only supports erasable syntax. Mitigation: `erasableSyntaxOnly` in the base tsconfig makes the compiler enforce it everywhere shared code is used.
14. **TypeScript 7 (native compiler) ecosystem gaps.** It has no JS API, so only the `tsc` CLI is used; fallback pin 6.0.3 if needed.
15. **CPU time on Workers Free.** 10 ms per request is tight for this request path. Mitigation: module-scope caching (section 10) and a Claims item recommending Workers Paid. Bundle size is not a risk (64 MiB uncompressed limit; about 2.7 MiB measured).
16. **Test runtime drift.** The test pool runs wrangler 4.148.0 and an alpha miniflare nested inside `@cloudflare/vitest-plugin@1.3.7`, while dev uses wrangler 4.149.0. Mitigation: exact pin; the seed round trip runs through the top-level wrangler too, so both runtimes are exercised on the same data.
17. **Scope.** This is one of four v1 projects. Mitigation: the P0 and P1 split in section 1, archetype-generated facts, and a commit plan where P1 starts only after the first recorded local eval.

## 24. Review log

Revision 2 responds to one skeptical review of revision 1 (verdict: "Approve with required changes"). Every blocking and important finding is resolved. Every minor finding is resolved except M18, which confirmed facts and needed no change. Where I changed an API fact, I first re-verified it myself: my own probes are in `scratchpad/pd-verify` (pool vars, D1 `exec`, `outboundService` plus remote JWKS, single-batch approval) and `scratchpad/pd-seedfile` (`char(10)` seed file through `wrangler d1 execute`), and the docs and type files I read are cited in section 22.

| Finding | Resolution | Where |
|---|---|---|
| B1. `.dev.vars` leaks into the test pool | Accepted and reproduced. Every workerd project pins every `CONFIG_KEYS` var through `miniflare.bindings` from `BASE_TEST_VARS` (typed `satisfies Record<ConfigKey, string>`). My probe also showed that a key only in `.dev.vars` still leaks, so `parseConfig` now reads only `CONFIG_KEYS`. Added `config.pinned.test.ts` (health reports `stub`, `d1-fts`, `dev`). | Sections 5, 14 |
| B2. `D1Database.exec()` breaks on multi-line seed text | Accepted and reproduced. `seedStatements(): Array<{ sql, params }>` is the single source. Worker setup applies it with `DB.batch` in chunks of 100 and never calls `exec`. `seed.sql` is rendered from the same list with `' \|\| char(10) \|\| '` newlines, verified through `wrangler d1 execute --local --file` (re-runnable, FTS in sync). Added `seed-sql.roundtrip.test.ts` (no raw newline; byte-for-byte round trip through wrangler) and a byte-for-byte check in `seed.counts.test.ts` for the batch path. | Sections 12, 14 |
| B3. Config-variant tests cannot run in one project; production JWKS path untested | Accepted. Added projects `worker-access` (access mode, service tokens on, `outboundService` serving the JWKS for `https://team.test` and 599 otherwise) and `worker-adversarial`. My probe verified `createRemoteJWKSet` through `outboundService` end to end. `parseConfig` rejects `stub` and `adversarial-stub` in access mode, so `worker-access` uses `openai-compatible` pointed at a 599 host, which also gives the provider-failure test. No header or query switch exists. The invalid-config cases that never reach the Durable Object call the Worker's `fetch` with a spread env inside the main project. | Sections 2, 5, 11, 14 |
| I1. Approval finalize not atomic; audit can lie | Accepted and strengthened beyond the suggested fix: claim, conditional write, `CASE` finalize and outcome-labeled audit now run in ONE batch, gated on a per-request `claim_id`. No row is ever left in `executing` after commit. `already_booked` is detected by a `NOT EXISTS` guard instead of a constraint abort, with the UNIQUE keys kept as backstops. The exact SQL passed five scenarios in local D1. Defensive reconciliation checks `tickets.action_id` and `orientation_bookings.action_id`. Added `actions.crash-after-commit.test.ts` using a constructor-only `afterCommit` hook. | Sections 6, 10, 14 |
| I2. Headline metric overstates grounding | Accepted. `headline` is renamed `overallPassRate`; `groundedAnswerAccuracy` (95 cases) is the metric that matches the resume phrase. `update-readme` prints both with definitions. Claims item 3 asks Nitish which one the resume quotes. | Sections 0, 13, 14, 17 |
| I3. Leak detector noisy and weak; disjointness invariant unsatisfiable | Accepted. (a) Restricted facts use rank-specific value bands, and the generator rejection-samples against the normalized numeric tokens of every lower-rank document (throwing if impossible), so the invariant holds by construction. (b) `leak.ts` scans only `text`, `citations[].quote` and `toolResult`, strips ISO dates and id patterns first, and uses the scorer's normalizer, so paraphrases are caught and trace numbers are never flagged. Action cases use exact `restrictedTokens` (the target's record ids). | Sections 12, 13, 14 |
| I4. Absolute version dates contradict `--as-of` | Accepted. All version dates are month offsets from `firstOfMonth(AS_OF)`; scheduled versions are 3 to 9 months after. Counts are asserted for three AS_OF values. Datasets live in `asof-<date>/` directories, `dataset_meta` records the seeded dataset, and the runner checks `datasetSha256` and the validity window. Orientation sessions now start at AS_OF + 14 days, so a production dataset stays valid for 14 days. | Sections 4, 6, 12, 13 |
| I5. Router cannot resolve people; `out_of_scope` mapping missing | Accepted (directory-slice option). The router sees the permitted directory slice (direct reports for managers, onboarding hires for hr_admin, nobody for employees). Deterministic resolution maps names to ids, and unknown or unpermitted names get one identical refusal. Added a complete router-to-`kind` mapping in which `out_of_scope` gives `refuse`. 2 of the 15 unauthorized action cases use explicit ids to exercise the tool-level check, and the README discloses this. | Sections 7, 8, 13, 14 |
| I6. Service tokens can approve | Accepted. Approve requires `identityKind === "user"` (403 `human_approval_required`), encoded in the authz matrix. Production `ALLOW_SERVICE_TOKENS` defaults to `false`; `deploy:eval-window` (`wrangler deploy --var ALLOW_SERVICE_TOKENS:true`, flag verified) opens an eval window and `deploy` closes it. Tested in `access.service-tokens.test.ts`. | Sections 1, 2, 5, 8, 9, 14, 17, 18 |
| I7. AI Search fails silently by default | Accepted and verified in workers-types. Requests send `return_on_failure: false` (and disable `query_rewrite` and the AI Search `cache` for reproducibility). Retriever errors become `kind: "error"` (`retrieval_unavailable`) and are counted apart from wrong answers. `verify:ai-search` asserts non-empty results per clearance level and that an invalid filter throws. The eval aborts above 5 zero-passage answerable cases. | Sections 2, 7, 11, 13, 18 |
| I8. AI Gateway cost may not exist for Workers AI | Accepted and extended. `cost.source` is `ai-gateway` only when every call's log has a numeric cost, and it is labeled "AI Gateway's cost estimate". Otherwise it is `gateway-tokens-x-list-price` or `trace-tokens-x-list-price`. `skipCache: true` is set on eval calls, and metadata uses exactly 5 entries. New finding from the docs: gateways created after 2026-09-24 use new logging, and only Legacy Logs documents a Logs API. Added a binding-backed reader route plus `verify:gateway`, and Claims item 2 now covers both log readability and non-null cost. | Sections 8, 11, 13, 17, 18, 23 |
| I9. Workers Free 10 ms CPU limit ignored | Accepted. Module-scope caching of config, JWKS, tool definitions and JSON Schemas, and a cheap per-request MCP factory. Claims item 8 says Workers Paid ($5/month) is likely required. While checking, I found the limits page now says gzip size is not a limit (64 MiB uncompressed on both plans), so the old "fits the free plan's compressed limit" wording was corrected. | Sections 10, 17, 23 |
| I10. Scope unrealistic | Accepted. Facts come from 9 archetypes; blueprints are 100 compact rows with subject phrases; only the 6 ambiguity groups are hand-written. Added the P0 and P1 table, P1 markers throughout, and a commit plan where P1 starts after the first local eval. One deliberate deviation: `markdown.test.tsx` stays P0 because it is the only check that R2 markdown never reaches the DOM as raw HTML. The binding gateway-log route is P0 because of the I8 finding. | Sections 1, 4, 12, 14, 15, 21 |
| M1. Test runtime is not wrangler 4.149.0 | Accepted and verified (nested wrangler 4.148.0, miniflare 5.20261006.0-alpha; 1.4.0 published 2026-10-08 18:27 UTC). Exact pin `1.3.7`, install only the plugin, README naming as suggested. | Sections 3, 16, 20, 23 |
| M2. TypeScript 7 has no JS API | Accepted. Documented that only the `tsc` CLI may be used; 6.0.3 fallback kept. | Sections 3, 23 |
| M3. `wrangler dev` fails with this config | Accepted. Dropped `wrangler dev` as a local runtime rather than adding an `assets.directory` that duplicates the Vite plugin. | Sections 5, 16 |
| M4. `initialState` from `this.name` is risky | Accepted. Dropped Agent state entirely; ids are derived in `onStart`, and `getAgentByName` awaiting `__unsafe_ensureInitialized` was re-checked in the source. | Section 7 |
| M5. `turnInFlight` release and turn ceiling | Accepted. `TurnLock` releases in `finally` and has a 60 s ceiling with `AbortSignal`; Workers AI calls pass `requestTimeoutMs`. Tested with a latch and through `runInDurableObject` (export verified). | Sections 7, 14 |
| M6. Approve not idempotent; rate limit races | Accepted. Requester retries on a decided row return 200 with `replayed: true`. The rate limit is one conditional `INSERT ... SELECT` counting only non-expired rows, tested with 7 concurrent proposals. | Sections 6, 8, 14 |
| M7. `arguments_sha256` is not tamper resistance | Accepted, documented as an integrity check only. An HMAC was considered and rejected: it adds a production secret and guards against an attacker who already has D1 write access, which this design does not claim to defend. | Sections 6, 20 |
| M8. `approvalUrl` lacks the dev port | Accepted. In dev mode it uses the request origin, passed into the Agent. | Sections 7, 10, 14 |
| M9. Runner must send Origin and Content-Type | Accepted, and asserted in the in-pool smoke test. | Sections 13, 14 |
| M10. `/dev/stats` does not exist in production | Accepted. `/dev/stats` is removed. `writesWithoutApproval` uses run-start and run-end totals from `/api/tickets` per persona and session seat counts, valid at any concurrency because the runner never approves. | Sections 8, 13 |
| M11. `aiGatewayLogId` race reasoning wrong | Accepted. It is a hint only; logs are joined by `(turnId, purpose)` metadata through REST `search`, and the binding reader rejects mismatched `metadata.turnId`. | Sections 8, 11, 23 |
| M12. CI determinism across OS and timezone | Accepted. UTC-only date math, no `Intl` or `localeCompare`, LF via `.gitattributes`, `TZ=UTC` in CI, and a child-process generation test under two timezones. | Sections 4, 12, 14, 19 |
| M13. Storage isolation is per test file | Accepted. A distinct persona or session per scenario, with no order dependence. | Section 14 |
| M14. Test-only bindings untyped; runner not in worker tsconfig | Accepted. `test/types.d.ts` augments `Cloudflare.Env`; `evals/lib` is in `tsconfig.worker.json`. | Sections 4, 14 |
| M15. AI Search chunk mapping and sync | Accepted. `chunk-align.ts` maps each AI Search chunk to the best-overlapping D1 chunk of the same version for `section` and `passageId`, with a fallback id. `verify:ai-search` runs `jobs.create()` and waits on `stats()` (both verified in types). | Sections 4, 8, 11, 18 |
| M16. Infrastructure errors and number dumping | Accepted. `infrastructure` metrics are separate from wrong answers, with an abort above 5% error rate. Answers over 900 characters or with more than 4 distinct numbers fail as `number_dump`. | Section 13 |
| M17. Remote seeding unverified; FK delete order | Accepted. The fallback to chunked `--command` batches is now specified, and deletes run children first. Additionally, `employees` are upserted rather than deleted so real `identity_links` survive a reseed. | Sections 12, 18, 23 |
| M18. Verified facts | No change needed. | n/a |
