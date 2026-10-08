# PeopleDesk build progress

This file is the hand-off log for whoever continues the build. SPEC.md (revision 2) is the contract; this file records where the build stands against its commit plan (SPEC section 21).

## Commit plan position

- Done: commits 1 to 19 (scaffold; five Vitest projects; CI; D1 migrations; synth org; archetypes, blueprints and versioned corpus; disjointness, rendering, chunking; seed statements, seed.sql and the committed asof-2026-10-01 dataset; local seeding and batch-based worker test setup; auth with local and remote JWKS, principal resolution and the dev issuer; authz capability matrix; PolicyStore, D1 FTS5 retriever and permission gate; AI Search adapter and chunk alignment; read routes for policies, tickets, onboarding, orientation and team; MCP server with cached tool definitions, the four read tools, /mcp and the in-process client; ActionService with the single-batch approval, the two write tools and the approval endpoints; LLM providers and the binding gateway-log reader; ConversationAgent, turn lock, router and composer orchestration, citation validator, conversation routes; safety tests with the adversarial model and service tokens).
- Next: commit 20 (web: app shell, chat with citations, source drawer, approval cards).

## Status at the last commit

- `npm run typecheck`: pass
- `npm test`: pass (6 files, 20 tests across all five projects)
- `npm run deploy:check`: pass (offline dry run lists DB, POLICY_BUCKET, CONVERSATION_AGENT, AI, POLICY_SEARCH)
- `npx wrangler types --strict-vars false --check`: pass
- `npm run build`: pass

## Deviations from SPEC.md

1. `vite.config.ts` reads an optional `INSPECTOR_PORT` env var and passes it to `cloudflare({ inspectorPort })`. Reason: this Mac builds several repos at once and the default workerd inspector port can collide. Without the variable the plugin default applies, so the spec's behavior is unchanged.
2. Commit 1 includes a minimal `vitest.config.ts` (node project only) and `test/node/toolchain.test.ts` (exact pins, ESM package, .nvmrc). Reason: every commit must leave `npm test` green, and `vitest run` with no test files exits non-zero. Commit 2 replaces the config with the five-project shape.
3. Commits 2 to 9 served `/api/health` without a token; since commit 10 it is behind `requireAuth` as SPEC section 8 says.
4. CI's dataset determinism step (`npm run generate && git diff --exit-code ...`) was added in commit 8, when the generator existed.
8. `src/shared/synth/dataset.ts` (not in the SPEC file tree) builds the manifest, org and markdown files in memory; `scripts/generate.ts` writes them, and tests build them in memory. `src/shared/sha256.ts` is a synchronous pure-TS SHA-256 so the generator stays synchronous and identical on every runtime. `scripts/generate.ts` also accepts `--out <dir>` so the timezone determinism test can generate into a temp directory.
9. The manifest carries every chunk's text (the spec asks seed.counts to compare D1 chunk text with "the manifest chunk text"), which makes `manifest.json` about 500 KB.
6. Restricted-value disjointness versus the archetype bands (SPEC section 12). The spec's rank 2 and rank 3 bands for `count_per_year` (13-24, 25-36) and `notice_weeks` (13-20, 21-30) are almost entirely covered by numbers that rank 1 documents already contain (days 3-60, hours 1-40, percents 1-25 in half steps, review cadences 6/12/18/24). Measured on the committed seed: `count_per_year` rank 2 had 1 free value of 12 and rank 3 had 0, `notice_weeks` likewise. The mandated resampling therefore threw ("could not draw an acceptable count_per_year value for POL-098.f1@v2"). Resolution: the bands stay exactly as specified, the generator still enforces disjointness and throws when it cannot, and the 17 restricted blueprint facts that used those two archetypes were re-authored onto archetypes whose restricted bands are feasible (days, hours, money, percent). `count_per_year` and `notice_weeks` are used by `all` documents only; a test pins that rule.
7. Number normalization lives in `evals/lib/normalize.ts` as the spec's file tree says, and `src/shared/synth/corpus.ts` imports it, so the generator's N(r) and the scorer and leak check share one normalizer.
5. Small helper modules not named in the SPEC file tree: `src/worker/errors.ts` (AppError and the error envelope), `src/worker/hono-env.ts` (Hono context typing), `test/web/setup.ts` (testing-library cleanup).

10. Auth details the spec leaves open: `/dev/token` also runs `requireSameOrigin` (it is a state-changing POST outside `/api/*`); a service-token JWT while `ALLOW_SERVICE_TOKENS=false`, or one with no `identity_links` row, gets 403 `forbidden`; `/api/me` additionally returns `identityKind`; `/dev/personas` derives personas from the org generator (persona ids are identical for every business date, which `synth.org.test.ts` asserts) and lists only those present in D1. `scripts/dev-keys.ts` keeps existing keys unless `--rotate`, and also accepts `--llm-base-url` and `--llm-model`.

11. `src/worker/validation.ts` (zod validation with the error envelope) is an extra helper module. `GET /api/onboarding/:employeeId` writes an `authz_denied` audit row when it answers 404 for a person outside the caller's scope.

12. MCP: `ToolErrorCode` gains `retrieval_unavailable` (a retriever failure inside `search_policies` must reach the orchestrator as an error, never as an empty result or refusal). The SDK's own input-validation failures return `isError` with "Input validation error" text and no `structuredContent`; they never reach the tool callback, so they write no audit row (every call that reaches a tool writes `tool_call` or `authz_denied`). For a nonexistent employee id, `get_onboarding_progress` answers `forbidden` to non-HR callers (same as an out-of-scope person) and `not_found` only to HR. `search_policies` reports retrieval counts in the result's `_meta["peopledesk/retrieval"]` for the turn trace. Tests that call `/mcp` through `SELF.fetch` set the Host header, which real HTTP requests always carry.

13. Actions: `PendingActionView` also carries `source`, `conversationId` and `supersededBy`. Business-rule failures on `POST /api/actions` map to 409 `conflict` with `details.reason` (`not_in_onboarding`, `session_full`, `already_booked`, `session_in_past`), and `rate_limited` to 429. Editing (`supersedes`) is one batch: the new row is inserted under the rate limit (the row being replaced does not count), then the old row is marked `rejected` with `superseded_by`. Reconciliation of a row seen in `executing` reports the stored outcome with `replayed: true`. Re-authorization at approval also re-checks that a ticket's related policy is still readable and that the session has not started.

14. LLM layer: `src/worker/chat/prompts.ts` (router and composer prompts, schemas and message builders) landed in commit 17 instead of 18, because the stub providers read the same messages a real model reads and parse them with the helpers defined there. The REST gateway-log reader (`evals/lib/gateway.ts`) is written with the eval runner (commit 23); the binding reader (`src/worker/llm/gateway-log.ts`) is in commit 17 and its route lands with the conversation routes (commit 18). A stub routing table test (`test/node/llm.stub.test.ts`) documents the test double's behavior.

15. Chat: `ConversationAgent.sendMessage` returns `{ ok: true, result } | { ok: false, code: "turn_in_progress" }` instead of throwing, because an exception thrown across Durable Object RPC is logged by workerd as an uncaught error on every 409; the route still answers 409 `turn_in_progress`. The agent exposes `turnLock` (for the `runInDurableObject` test) and a `providerOverride` field that only tests can set through `runInDurableObject`. `trace.gatewayLogIdHints` entries are `"<purpose>:<logId>"`, so the binding reader knows which call each hint belongs to. Approve and reject record the outcome in the originating conversation through `recordActionOutcome`. Tool errors map to fixed texts in `render.ts` (for example `not_in_onboarding` and `already_booked` refuse, `session_full` clarifies). `people.ts` types its D1 parameter structurally so the name resolution is testable under Node; slice-per-role and turn-level person refusals are tested in the worker project (`test/worker/chat.people.test.ts`) in addition to `test/node/chat.people.test.ts`. The worker-access project pins `APP_HOSTNAME=peopledesk.test` (the MCP handler checks Host against it).
16. `wrangler types` reads `.dev.vars`: the committed `worker-configuration.d.ts` is generated with `.dev.vars` moved aside, so `wrangler types --check` passes in CI (no `.dev.vars`) and fails locally while a `.dev.vars` exists (SPEC risk 8, confirmed). Move `.dev.vars` aside before `npm run types`.

17. `evals/lib/leak.ts` landed in commit 19 (not 23) because the adversarial safety test uses it; `test/node/eval.leak.test.ts` came with it. `chat.no-approval-via-chat.test.ts` landed in commit 18.

## Local machine notes for builders

- Shared ports on this Mac: if you start a dev or preview server, use `--port 8782 --strictPort` and `INSPECTOR_PORT=9232`. If an eval needs llama-server, run it on port 8120 with `-np 1 -c 8192 -ngl 99` against `~/Developer/projects/_models/Qwen3-1.7B-Q4_0-rtn.gguf`, and kill it afterwards.
- Do not push; pushing happens after verification.
