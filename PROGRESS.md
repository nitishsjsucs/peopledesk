# PeopleDesk build progress

This file is the hand-off log for whoever continues the build. SPEC.md (revision 2) is the contract; this file records where the build stands against its commit plan (SPEC section 21), the exact check status, and every deviation from the spec with its reason.

## Commit plan position

- Done: all P0 commits, 1 to 25, plus one extra commit (production scripts, between 23 and 24).
  1 scaffold; 2 five Vitest projects; 3 CI; 4 D1 migrations; 5 synth PRNG, dates and org; 6 archetypes, blueprints, versioned corpus; 7 disjointness, rendering, chunking; 8 seed statements, seed.sql and the committed dataset; 9 local seeding and batch test setup; 10 auth; 11 authz matrix; 12 PolicyStore, D1 FTS5 retriever, permission gate; 13 AI Search adapter and chunk alignment; 14 read routes; 15 MCP server, read tools, `/mcp`, in-process client; 16 ActionService, write tools, approval endpoints; 17 LLM providers and gateway log reader; 18 ConversationAgent and orchestration; 19 safety tests; 20 web shell and chat; 21 web pages and forms; 22 eval dataset; 23 eval runner, scorer, report; extra: remote seeding, identity linking, verification and llama-server scripts; 24 README; 25 first local eval run and README results.
- Next: P1 commits 26 to 28 (home page, manager onboarding view and ticket status filter; dark theme and policy viewer tests; R2 S3 API fallback and link-identity polish). Work for them may already be in the working tree or later commits; check `git log`.

## Status at the last commit

All checks run on 2026-10-08 on this Mac.

- `npm run typecheck`: pass (worker, web and node tsconfigs, TypeScript 7.0.2)
- `npm test`: pass, 407 tests in 52 files across the five projects (`worker`, `worker-access`, `worker-adversarial`, `node`, `web`)
- `npm run build`: pass
- `npm run deploy:check`: pass (offline dry run lists `CONVERSATION_AGENT`, `DB`, `POLICY_SEARCH`, `POLICY_BUCKET`, `AI`)
- `npm run generate && git diff --exit-code -- data/generated evals/dataset`: no diff
- `npx wrangler types --strict-vars false --check`: pass with `.dev.vars` moved aside (see deviation 16)

## First local eval run (commit 25)

Command: `npm run eval -- --base-url http://localhost:8782 --run-id local-qwen3-1.7b-2026-10-08 --concurrency 1`, against `vite preview` on port 8782 with `LLM_PROVIDER=openai-compatible` pointed at `llama-server` (Qwen3-1.7B-Q4_0-rtn.gguf, port 8120, `-np 1 -c 8192 -ngl 99 --jinja --reasoning-budget 0 --temp 0`), after `npm run db:reset:local`. Output: `evals/results/local-qwen3-1.7b-2026-10-08/`.

- groundedAnswerAccuracy 90.5% (86/95, Wilson 95% CI 83.0% to 94.9%); overallPassRate 61.5% (123/200).
- Safety gates all 0 (leaks, writes without approval, forbidden-target pending actions); 0 infrastructure errors; 0 zero-passage answerable cases.
- Turn latency p50 2614 ms, p95 3540 ms. Cost source `trace-tokens-x-list-price` ($0.1442 for 347 calls at the Workers AI list price; an estimate, not a cost incurred).
- No prompt or code was tuned against the eval set before or after this run; three manual questions were asked first to confirm the pipeline worked end to end. Weak spots are the small model's routing (action tool selection 52.7%) and refusing instead of answering from a different permitted document on unauthorized questions.
- After the run, llama-server and the preview server were stopped and `.dev.vars` was switched back to `LLM_PROVIDER=stub`.

## Deviations from SPEC.md

1. `vite.config.ts` reads an optional `INSPECTOR_PORT` env var and passes it to `cloudflare({ inspectorPort })`, because this Mac builds several repos at once. Without the variable the plugin default applies.
2. Commit 1 includes a minimal `vitest.config.ts` and `test/node/toolchain.test.ts` (exact pins, ESM package, `.nvmrc`), because `vitest run` with no test files exits non-zero. Commit 2 replaced the config with the five-project shape.
3. Commits 2 to 9 served `/api/health` without a token; since commit 10 it is behind `requireAuth` as SPEC section 8 says.
4. CI's dataset determinism step was added in commit 8, when the generator existed. Another agent later changed it to `git diff --exit-code -- <paths>` (commit `e474ae3`), which tolerates a path that does not exist yet.
5. Small helper modules not in the SPEC file tree: `src/worker/errors.ts`, `src/worker/hono-env.ts`, `src/worker/validation.ts`, `src/shared/sha256.ts`, `src/shared/synth/dataset.ts`, `src/shared/synth/r2-objects.ts`, `src/worker/policies/ai-search-request.ts`, `src/web/lib/session.tsx`, `src/web/lib/use-async.ts`, `scripts/lib/cloudflare.ts`, and test helpers (`test/helpers/{actions,chat,mcp,services}.ts`, `test/web/{setup,fixtures}.ts`).
6. Restricted-value disjointness versus the archetype bands (SPEC section 12). The spec's rank 2 and rank 3 bands for `count_per_year` (13-24, 25-36) and `notice_weeks` (13-20, 21-30) are almost entirely covered by numbers rank 1 documents already contain (days 3-60, hours 1-40, percents 1-25 in half steps, review cadences). Measured: `count_per_year` rank 2 had 1 free value of 12 and rank 3 had 0, so the mandated resampling threw. The bands stay as specified, the generator still enforces disjointness and throws, and the 17 restricted blueprint facts that used those two archetypes were re-authored onto feasible archetypes. A test pins that restricted documents never use them.
7. Number normalization lives in `evals/lib/normalize.ts` (as the file tree says) and the generator imports it, so N(r), the scorer and the leak check share one normalizer.
8. `scripts/generate.ts` also accepts `--out <dir>` (used by the timezone determinism test) and writes `evals/dataset/asof-<date>/meta.json` (asOf, validity window, dataset hash) next to `cases.jsonl`.
9. The manifest carries every chunk's text (the spec compares D1 chunk text with "the manifest chunk text"), so `manifest.json` is about 500 KB.
10. Auth details the spec leaves open: `/dev/token` also runs `requireSameOrigin`; a service-token JWT while `ALLOW_SERVICE_TOKENS=false`, or one without an `identity_links` row, gets 403 `forbidden`; `/api/me` also returns `identityKind`; `/dev/personas` derives personas from the org generator (persona ids are identical for every business date, which a test asserts). `scripts/dev-keys.ts` keeps existing keys unless `--rotate` and accepts `--llm-base-url` and `--llm-model`.
11. `GET /api/onboarding/:employeeId` writes an `authz_denied` audit row when it answers 404 for a person outside the caller's scope.
12. MCP: `ToolErrorCode` gains `retrieval_unavailable` (a retriever failure must reach the orchestrator as an error, never as an empty result). The SDK's own input-validation failures never reach the tool callback, so they write no audit row. For a nonexistent employee id, `get_onboarding_progress` and scheduling answer `forbidden` to non-HR callers (same as an out-of-scope person). `search_policies` reports retrieval counts in `_meta["peopledesk/retrieval"]`. Tests that call `/mcp` through `SELF.fetch` set the Host header, which real HTTP requests always carry.
13. Actions: `PendingActionView` also carries `source`, `conversationId` and `supersededBy`. Business-rule failures on `POST /api/actions` map to 409 `conflict` with `details.reason`; `rate_limited` maps to 429. Editing (`supersedes`) inserts the new row under the rate limit (the replaced row does not count) and marks the old one `rejected` with `superseded_by`, in one batch. Re-authorization at approval also re-checks that a ticket's related policy is still readable and that the session has not started.
14. `src/worker/chat/prompts.ts` landed in commit 17 (not 18) because the stub providers read the same messages a real model reads. The binding gateway reader landed in 17 and its route in 18; the REST reader landed with the runner (23).
15. Chat: `ConversationAgent.sendMessage` returns `{ ok: true, result } | { ok: false, code: "turn_in_progress" }` instead of throwing, because an exception thrown across Durable Object RPC is logged by workerd as an uncaught error on every 409; the route still answers 409. The agent exposes `turnLock` and a test-only `providerOverride` (reachable only through `runInDurableObject`). `trace.gatewayLogIdHints` entries are `"<purpose>:<logId>"`. Approve and reject record the outcome in the originating conversation. `people.ts` types its D1 parameter structurally so resolution is testable under Node; slice-per-role tests are in `test/worker/chat.people.test.ts` as well. The worker-access project pins `APP_HOSTNAME=peopledesk.test`.
16. `wrangler types` reads `.dev.vars`: the committed `worker-configuration.d.ts` is generated with `.dev.vars` moved aside, so `--check` passes in CI and fails locally while `.dev.vars` exists (SPEC risk 8, confirmed). Move `.dev.vars` aside before `npm run types`.
17. `evals/lib/leak.ts` and its test landed in commit 19 (the adversarial test uses it); `chat.no-approval-via-chat.test.ts` landed in 18.
18. Web: the chat bubble hides the deterministic "Source:" line because the citation chips carry it (it stays in `TurnResult.text`). `lib/api.ts` has a `setFetch` test seam.
19. Eval dataset: every case carries a `meta` object (subcategory, fact id, named person and slice membership, explicit id, session id) for the invariant tests; the scorer ignores it.
20. Eval harness: `npm run eval` also accepts `--dataset` and `--limit`; a limited run records the full dataset size, so `update-readme` refuses it as partial. Production auth sends Access service-token client ids and secrets (`PEOPLEDESK_SERVICE_TOKENS`) as `CF-Access-Client-Id`/`CF-Access-Client-Secret`. `summary.json` records the exact command.
21. Extra commit between 23 and 24 for the scripts the spec's npm scripts point at (`seed-remote`, `link-identity`, `verify-ai-search`, `verify-gateway`, `llm-serve`). The production ones need `npx wrangler login` and have not been run; they reuse tested modules. Remote bindings for `getPlatformProxy` come from a throwaway config generated from `env.production`, so `wrangler.jsonc` stays local-first. `llm-serve` defaults follow the spec (port 8080, `-np 2`) and take `--port`, `--parallel`, `--ngl`.
22. The first local eval used port 8782 (preview), llama-server on port 8120 with `-np 1`, and `--concurrency 1`, instead of the spec's 4173, 8080, `-np 2` and concurrency 2, because ports and the GPU are shared with other builds on this Mac. With one llama-server slot, concurrency 2 would only queue requests.

## Coordination notes

- Another agent works in this same checkout concurrently. It committed `ac700fa` (a README status rewrite) and `e474ae3` (the CI pathspec fix). My commit `cffaf55` (commit 16) accidentally swept that agent's uncommitted README draft in through `git add -A`. Since then: stage explicit paths only, and check `git status` and `git log` before committing.
- Commit 24 merged the README: the spec's section 20 outline plus a current Status table and the other agent's "Why" section.
- Manual UI check on 2026-10-08 with `vite dev` on port 8782: dev login, a cited answer, a chat-proposed ticket approved from its card, the policy viewer and the orientation form all worked against locally seeded data.

## Local machine notes for builders

- Shared ports on this Mac: use `--port 8782 --strictPort` and `INSPECTOR_PORT=9232` for dev or preview servers. For llama-server use port 8120 with `-np 1 -c 8192 -ngl 99` against `~/Developer/projects/_models/Qwen3-1.7B-Q4_0-rtn.gguf` (`node scripts/llm-serve.ts --port 8120 --parallel 1 --ngl 99`), and kill it afterwards.
- `.dev.vars` currently has `LLM_PROVIDER=stub`. To run against the local model: `npm run dev:keys -- --llm-provider openai-compatible --llm-base-url http://127.0.0.1:8120/v1`.
- Do not push; pushing happens after verification.
