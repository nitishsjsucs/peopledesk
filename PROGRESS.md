# PeopleDesk build progress

This file is the hand-off log for whoever continues the build. SPEC.md (revision 2) is the contract; this file records where the build stands against its commit plan (SPEC section 21), the exact check status, and every deviation from the spec with its reason.

## Commit plan position

- Done: every commit in the plan. P0 commits 1 to 25, one extra commit (production scripts, between 23 and 24), and P1 commits 26 to 28.
  1 scaffold; 2 five Vitest projects; 3 CI; 4 D1 migrations; 5 synth PRNG, dates and org; 6 archetypes, blueprints, versioned corpus; 7 disjointness, rendering, chunking; 8 seed statements, seed.sql and the committed dataset; 9 local seeding and batch test setup; 10 auth; 11 authz matrix; 12 PolicyStore, D1 FTS5 retriever, permission gate; 13 AI Search adapter and chunk alignment; 14 read routes; 15 MCP server, read tools, `/mcp`, in-process client; 16 ActionService, write tools, approval endpoints; 17 LLM providers and gateway log reader; 18 ConversationAgent and orchestration; 19 safety tests; 20 web shell and chat; 21 web pages and forms; 22 eval dataset; 23 eval runner, scorer, report; extra: remote seeding, identity linking, verification and llama-server scripts; 24 README; 25 first local eval run and README results.
  26 home page, manager onboarding view, ticket status filter; 27 dark theme and policy viewer tests; 28 R2 S3 API fallback (SigV4 signer tested against AWS's documented example) and link-identity `--list`/`--remove`.
- After the plan (builder 1): a best-effort fix for recording approval outcomes in the transcript, and the last P1 extras from SPEC section 1 (a change list between policy versions on the viewer, and an empty-state illustration).
- After the plan (builder 2, an audit against SPEC.md plus a manual UI pass), in commit order:
  - `test/node/canonical-json.test.ts`, the one test file in SPEC section 14 that was missing. It pins the arguments digest (checked independently with `shasum`) and compares the hand-written `sha256Hex` with `node:crypto`. It found that `canonicalJson` ignored `toJSON` (a Date became `{}`); fixed, and the committed dataset regenerates byte for byte.
  - `api.contract.test.ts` now covers every route (policy, conversation, action and dev routes were missing; `RejectResponseSchema` was checked nowhere), the error envelope on 400, 401, 403, 404, 409, 410 and 429, the 200 path of the gateway-logs route under a Workers AI env with a fake `AI` binding, and a route inventory from `buildApp().routes` that fails when a route has no contract case.
  - `chat.model-retry.test.ts`: the orchestrator's one retry on schema-invalid model output (SPEC section 7, step 2), and the fallbacks (generic clarify for the router, the not-found refusal for the composer). Breaking the retry loop fails 4 of its 5 cases.
  - Config tests: `getConfig` and `verifierFor` module-scope caches, and 500 `misconfigured` on every route (not only `/api/health`).
  - Docs: the Access application needs a Service Auth policy for service tokens, and a service token's `common_name` is its Client ID (both checked in the Cloudflare docs on 2026-10-08); README and `link-identity` usage updated.
  - Fixed: the orientation form proposed a booking for the manager or HR admin themself while showing a report as the attendee.
  - Fixed: Edit on the review step of `/requests/ticket` and `/requests/orientation` left the review card on screen instead of the prefilled form.
  - Fixed: at phone width the main navigation collapsed to zero width (no way to navigate), and between about 800px and 1080px the last links were cut off.
  - Fixed: after a reload, approval cards in chat showed their stored state (enabled Approve after a rejection); they now show the request's current state.
  - New web tests for `OrientationForm`, `ScheduleOrientationPage`, `ActionsPage`, the ticket edit round trip and reloaded chat cards (P1 web tests in SPEC section 1).
- After the plan (builder 3), in commit order:
  - `2a033dc` docs: `CONTEXT.md` (domain glossary, no implementation details) and ten ADRs in `docs/adr/` for the decisions a reader would most likely question (single-batch approval, router and composer split, Worker-side Access JWT verification, permission gate over retriever filters, human-only approval, generated corpus, deterministic grading, pinned test config, in-process MCP client, one Durable Object per conversation). The README links them under "Design decisions".
  - `3349bf8` fix(evals): the README writer labels the finish date as UTC (a Pacific-evening run printed the next day). Test-first in `eval.report.test.ts`.
  - `1d29933` eval: a second full local run at `7517b30` (details below). It reproduced the first run exactly; the README Results block now comes from it.
  - `68c280f` ci: `permissions: contents: read` and a `concurrency` group that cancels superseded runs. Steps unchanged.
  - A final docs commit refreshing this file and correcting one sentence in ADR 0002 (routing mistakes cause most action-case failures; action tool selection is not the lowest metric, the unauthorized pass rate is).
- After the plan (fixer, review round 1 on 2026-10-08): fixes for three independent reviews (correctness, security, honesty), in commit order. Each finding and its outcome is under "Review findings" below.
  - `d6e3c25` test(actions): deterministic approval races (a D1 proxy holds the first two `batch()` calls at a barrier) and edit coverage.
  - `570e69b` fix(actions): an edit is created only while the request it replaces is still awaiting approval (same transaction).
  - `a6601b4` test(seed): R2 metadata values, and the AI Search filters applied to `r2PolicyObjects`.
  - `2e2d493` test(actions): approval links keep the dev server's port, for MCP and chat.
  - `836255e` test(safety): the audit-trail case makes its own denial (no order dependence).
  - `c349a1c` test(chat): a turn over the ceiling answers `turn_timeout`.
  - `04c039b` test(chat): `X-PeopleDesk-Eval` reaches every LLM call's gateway metadata.
  - `1e57ca4` fix(chat): the eval header is honored only for service tokens or in dev mode.
  - `59f30af` test(seed): the seed.sql round trip runs FTS5's integrity check.
  - `4acc102` fix(llm): one retry layer for Workers AI JSON mode failures.
  - `1c273c5` fix(evals): the cost source is decided per turn.
  - `414b7c3` fix(policies): `search_policies` honors `category` with the AI Search retriever.
  - `b938e8f` fix(policies): the count of passages dropped for clearance stays server-side.
  - `2e4fac1` fix(chat): internal error details stay in the logs.
  - `d514e20` fix(web): anti-framing headers on the SPA and every Worker response.
  - `4dbb375` fix(evals): the citation precision row states which turns it counts (README block regenerated from the same r2 `summary.json`).
  - `4f4e837` docs: README, CONTEXT.md, ADR 0005 and a one-line SPEC.md header claim only what was run and what the approval check proves.
  - A final docs commit updating this file.
- After the plan (final verification gate, 2026-10-08): a fresh clone of `eee084a` passed every CI step and reproduced the local eval; the README Results block now comes from that run (`local-qwen3-1.7b-2026-10-08-gate`). Details under "Final verification gate".
- Next: everything that needs Nitish (SPEC section 17): `wrangler login`, deploy, `verify:ai-search`, `verify:gateway`, the production eval in the eval window and the resume wording choices. Also his decision on which git history GitHub should carry (see "Coordination notes": the repo is already public, published by a mirror script with rewritten commit messages). Nothing else in the commit plan or the orchestrator's list (evals, README, ADRs, CI) is open.

## Status at the last commit

Final verification gate, 2026-10-08, in a fresh clone (`git clone ~/Developer/projects/peopledesk /tmp/gate-peopledesk` at `eee084a`, no `.dev.vars`, no `.wrangler` state, no `node_modules`):

- `npm ci`: pass (292 packages; npm audit reports 7 high severity advisories, see "Final verification gate")
- `npm run typecheck`: pass
- `npm test`: pass, 482 tests in 65 files (84 s, load average about 20)
- `npm run build`: pass
- `npm run deploy:check`: pass (bindings `CONVERSATION_AGENT`, `DB`, `POLICY_SEARCH`, `POLICY_BUCKET`, `AI`)
- `TZ=UTC npm run generate && git diff --exit-code -- data/generated evals/dataset`: no diff
- `npx wrangler types --strict-vars false --check`: pass (the clone has no `.dev.vars`)
- After the gate's eval commit (`ba323e8`), in this checkout: `npm run typecheck` pass, `npm test` pass (482 tests in 65 files, 37 s), `npm run build` pass.

Earlier status (fixer, after the last code change, at `4dbb375` plus the docs commits), all checks run on 2026-10-08 on this Mac:

- `npm run typecheck`: pass (worker, web and node tsconfigs, TypeScript 7.0.2)
- `npm test`: pass, 482 tests in 65 files across the five projects (`worker`, `worker-access`, `worker-adversarial`, `node`, `web`), 97 s
- `npm run build`: pass
- `npm run deploy:check`: pass (offline dry run lists `CONVERSATION_AGENT`, `DB`, `POLICY_SEARCH`, `POLICY_BUCKET`, `AI`)
- `npm run generate && git diff --exit-code -- data/generated evals/dataset` (with `TZ=UTC`): no diff
- `npx wrangler types --strict-vars false --check`: pass with `.dev.vars` moved aside (see deviation 16)
- `npm ci` was not rerun this round; `package-lock.json` is unchanged since commit 1.

## First local eval run (commit 25)

Command: `npm run eval -- --base-url http://localhost:8782 --run-id local-qwen3-1.7b-2026-10-08 --concurrency 1`, against `vite preview` on port 8782 with `LLM_PROVIDER=openai-compatible` pointed at `llama-server` (Qwen3-1.7B-Q4_0-rtn.gguf, port 8120, `-np 1 -c 8192 -ngl 99 --jinja --reasoning-budget 0 --temp 0`), after `npm run db:reset:local`. Output: `evals/results/local-qwen3-1.7b-2026-10-08/`.

- groundedAnswerAccuracy 90.5% (86/95, Wilson 95% CI 83.0% to 94.9%); overallPassRate 61.5% (123/200).
- Safety gates all 0 (leaks, writes without approval, forbidden-target pending actions); 0 infrastructure errors; 0 zero-passage answerable cases.
- Turn latency p50 2614 ms, p95 3540 ms. Cost source `trace-tokens-x-list-price` ($0.1442 for 347 calls at the Workers AI list price; an estimate, not a cost incurred).
- No prompt or code was tuned against the eval set before or after this run; three manual questions were asked first to confirm the pipeline worked end to end. Weak spots are the small model's routing (action tool selection 52.7%) and refusing instead of answering from a different permitted document on unauthorized questions.
- After the run, llama-server and the preview server were stopped and `.dev.vars` was switched back to `LLM_PROVIDER=stub`.

## Second local eval run (builder 3)

Command: `npm run eval -- --base-url http://localhost:8782 --run-id local-qwen3-1.7b-2026-10-08-r2 --concurrency 1`, against `INSPECTOR_PORT=9232 npx vite preview --port 8782 --strictPort` (after `npm run build`) with `.dev.vars` set by `npm run dev:keys -- --llm-provider openai-compatible --llm-base-url http://127.0.0.1:8120/v1`, and `node scripts/llm-serve.ts --port 8120 --parallel 1 --ngl 99` (Qwen3-1.7B-Q4_0-rtn.gguf, `-c 8192 --jinja --reasoning-budget 0 --temp 0`), after `npm run db:reset:local`. `/api/health` was checked first (provider `openai-compatible`, model `qwen3-1.7b-q4_0`, retriever `d1-fts`, the committed dataset hash); no chat question was asked before the run. Server git SHA `7517b30`. Started 2026-10-08 16:50 Pacific, 599 s. Output: `evals/results/local-qwen3-1.7b-2026-10-08-r2/`.

- groundedAnswerAccuracy 90.5% (86/95, Wilson 95% CI 83.0% to 94.9%); overallPassRate 61.5% (123/200). Safety gates all 0; 0 infrastructure errors; 0 zero-passage answerable cases.
- `summary.json` is identical to the first run's except `runId`, timestamps, `command`, `server` (git SHA) and `latencyMs`; `failures` is the same list. Comparing the two `results.jsonl` files case by case (an ad hoc node one-liner, not a repo script, so it is not quoted in the README Results block): all 200 cases have the same pass/fail, kind, reasons, answer text, citations, tool selection and argument match.
- Turn latency p50 2726 ms, p95 4825 ms, max 5524 ms (first run: p50 2614, p95 3540). The Mac was on battery (77%) with other repos' test suites running; load average was about 7 to 14.
- No prompt or code was tuned against the eval set. Afterwards the preview server and llama-server were stopped, `.dev.vars` was switched back to `LLM_PROVIDER=stub` with `LLM_BASE_URL=http://127.0.0.1:8080/v1`, and `npm run db:reset:local` restored the seeded state.
- `npm run eval:readme -- evals/results/local-qwen3-1.7b-2026-10-08-r2/summary.json` wrote the README Results block. The paragraph under the block (hand-written) says it is the second run and that the first matched it.

## Final verification gate (2026-10-08)

Run in the fresh clone `/tmp/gate-peopledesk` at `eee084a` (removed afterwards), after the CI steps listed under "Status at the last commit".

Eval setup: `npm run dev:keys -- --llm-provider openai-compatible --llm-base-url http://127.0.0.1:8120/v1`, `npm run db:reset:local`, `node scripts/llm-serve.ts --port 8120 --parallel 1 --ngl 99` (Qwen3-1.7B-Q4_0-rtn.gguf, `-c 8192 --jinja --reasoning-budget 0 --temp 0`), `npm run build`, `INSPECTOR_PORT=9232 npx vite preview --port 8782 --strictPort`. Command: `npm run eval -- --base-url http://localhost:8782 --run-id local-qwen3-1.7b-2026-10-08-gate --concurrency 1`. Started 2026-10-08 17:49:52 Pacific, 467 s, 200 of 200 cases, not aborted. The Mac was on battery (49%) with three other repos' test suites and an eval running (load average 17 to 20). Both servers were stopped afterwards and the clone was deleted.

- groundedAnswerAccuracy 90.5% (86/95, Wilson 95% CI 83.0% to 94.9%); overallPassRate 61.5% (123/200). Safety gates all 0; 0 infrastructure errors; 0 zero-passage answerable cases.
- `summary.json` equals the r2 run's except `runId`, timestamps, `command`, `server.gitSha` and `latencyMs`; `failures` is the same list. A case-by-case comparison with the r2 `results.jsonl` (an ad hoc Python check, not a repo script) found no difference in pass/fail, kind, reasons, leak flag, answer text, cited doc/version/section, tool selection, argument match, HTTP status or pending-action fields. So the review-round code changes between `7517b30` and `eee084a` did not change any graded outcome with the local model.
- Turn latency p50 2304 ms, p95 3281 ms, max 3982 ms.
- The results directory was copied into this checkout as `evals/results/local-qwen3-1.7b-2026-10-08-gate/`, and `npm run eval:readme -- evals/results/local-qwen3-1.7b-2026-10-08-gate/summary.json` rewrote the README Results block. The hand-written paragraph under it and the Status row now say three runs, and the SHA note maps `eee084a` as well.
- Why the README block changed although the grades matched: it cited a run at `7517b30`, twenty commits before the code it ships with, and its latency row was not what this pass measured. The gate run is at the shipped code.
- npm audit (from `npm ci`): 7 high severity advisories. Runtime: `@modelcontextprotocol/sdk` 1.30.0 and `@modelcontextprotocol/client` 2.0.0 (GHSA-6qxp-vccf-f47h, the OAuth client could send credentials to an authorization server chosen by the MCP server) and `agents`, which depends on them. PeopleDesk's only MCP client is the in-process `StreamableHTTPClientTransport` with no OAuth provider, talking to its own server, so the advisory's path is not used; the suggested fix (`agents@0.20.0`) is a breaking downgrade. Dev only: `sharp` through `miniflare`, `wrangler` and `@cloudflare/vitest-plugin`. Not changed by the gate.

Resume claims (SPEC section 0) as judged by the gate: the summary sentence needs Nitish (the "internal" framing; SPEC section 17 item 4); "conversational interface with structured request forms, permission-aware retrieval, and authenticated tools" is true; bullet 1 needs Nitish for Workers AI and AI Search (implemented and tested against fakes only; every measured answer came from Qwen3-1.7B and FTS5) and is true for React/TypeScript, Workers (workerd locally), R2 (Miniflare locally) and 100 documents with 155 versions; bullet 2 is true for six typed tools, validated inputs, user-scoped access and approval checkpoints, and needs rewording for Access (JWT verification is built and tested against local JWKS; Access itself has not run); bullet 3 is true for the 200-case harness and its categories, the 90% target is met locally (90.5%, 86/95, Qwen3-1.7B and FTS5), and "latency and cost through AI Gateway" is not true until a production eval reports `cost.source = "ai-gateway"` (locally: per-stage latency and a token-count estimate at Workers AI list price).

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
23. P1 commit 26 and 27 both touched `styles.css` and `AppShell.tsx`; commit 26 was made from an intermediate copy of those two files (home styles and the brand link only) so each commit stays self-contained. `seed:remote --r2 s3` (and the automatic fallback) needs an R2 API token (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) and `CLOUDFLARE_ACCOUNT_ID`; it has not been run against R2.

24. `api.contract.test.ts` calls the Worker's exported `fetch` with a spread env (`LLM_PROVIDER=workers-ai`, a fake `AI` binding) on a path that reaches the Durable Object. SPEC section 14 uses spread envs only for paths that never reach a Durable Object; this one works because the gateway-logs route only reads the turn trace, which does not depend on the Agent's own env. The stored trace's `gatewayLogIdHints` are set through `runInDurableObject`, because the stub provider records none.
25. Small UI changes beyond SPEC section 15, all from the manual pass: below 1080px the top bar wraps and the nav gets its own row; below 480px the user badge shows the role only (the full name stays in its accessible label and tooltip); an executed booking's card names its session.
26. `CONTEXT.md` and `docs/adr/0001` to `0010` are not in the SPEC section 4 file tree. They were added in builder 3's round because the orchestrator asked for ADRs and the owner's other repos keep a root glossary plus `docs/adr/`. They restate decisions already in SPEC.md (with the SPEC deviations they caused, for example deviation 6 in ADR 0006 and deviation 15 in ADR 0010); they introduce no new behavior.
27. CI (SPEC section 19) also sets `permissions: contents: read` and a `concurrency` group with `cancel-in-progress`. The run steps are unchanged: the spec's seven, with deviation 4's `--` pathspec separator.
28. The README Results line reads "finished <date> (UTC)". SPEC section 13 does not fix the wording; the label avoids a run finished on a Pacific evening appearing to be from the next day.
29. The second local eval used the same local setup as deviation 22 (ports 8782 and 8120, `-np 1`, concurrency 1) and the run id suffix `-r2`, because `local-qwen3-1.7b-2026-10-08` already existed and the runner refuses to overwrite a run.
30. Test files not in SPEC section 14's list, added in the review round: `test/worker/actions.race.test.ts`, `test/worker/chat.error-text.test.ts`, `test/node/ai-search-request.test.ts`, `test/node/static-headers.test.ts`. Test helpers gained `baseUrl` options (`api`, `mcpClient`, `newConversation`, `send`) and `recordLlmMetadata` (installs a recording stub through the agent's test-only `providerOverride`).
31. `TurnTrace.retrieval` no longer has `droppedForClearance` (SPEC section 7 lists it), and neither does the MCP `_meta["peopledesk/retrieval"]`. Sent to callers, the count revealed whether restricted documents matched a query whenever a retriever filter leaked. `search_policies` logs `retrieval_filter_leak` with the count instead. `PermissionGate` still reports it internally.
32. `ToolErrorCode` gains `internal`: an exception that is not a `ToolError` inside a tool is logged and returned as `internal: Internal error.` (it used to reach the SDK, which returned the exception text with no structured code, and a tool turn misread that as input validation). A turn's `error.message` is now always `ERROR_TEXT[code]`; details go to the logs with the turn id.
33. The Workers AI provider no longer retries "JSON Mode couldn't be met" itself; it throws `LlmInvalidOutputError` after one call and the orchestrator's single retry handles it (SPEC section 7: one retry, then the fallback). SPEC section 14 puts "one retry on JSON Mode couldn't be met" in `llm.workers-ai.test.ts`; the provider test there now asserts one call and the error, and the retry itself is asserted at turn level in `chat.model-retry.test.ts` ("Workers AI JSON mode failures"), including that the calls derived from the trace equal the real calls.
34. `X-PeopleDesk-Eval` is honored only when the principal is an Access service token or the Worker runs in dev mode (SPEC section 13 does not restrict it). The production eval uses service tokens, so it is unaffected; a signed-in user can no longer turn off the AI Gateway cache.
35. `PermissionGate.filter` takes an optional `category` and drops passages of other categories (AI Search cannot filter on category: R2 custom metadata is capped at five fields, all used).
36. `public/_headers` (not in the SPEC file tree) gives every static asset response `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'` and `X-Content-Type-Options: nosniff`; the Worker's first middleware sets the same three on `/api`, `/mcp`, `/dev` and error responses. Checked against `vite preview` on port 8782 (/, `/actions?focus=...`, SPA fallbacks, `/api/health`).
37. Editing with `supersedes` when the original was approved, rejected or expired after the JS check now fails with `conflict` (409, `details.reason: "conflict"`) and writes nothing; the INSERT itself requires the replaced row to be awaiting and unexpired.
38. `decideCost` takes `turnLogs` (logs per turn with each turn's `llmCalls`) instead of a flat `logs` list, and `collectGatewayLogs` returns that shape; AI Gateway's numbers are used only when every turn has at least as many logs as model calls.
39. The README and `summary.md` citation row reads "Citation precision (answer turns in the N policy_answerable and outdated_document cases; a citation is precise when it names an expected document version)" and "... fabricated labels dropped by the validator (all turns)". The two committed runs' `summary.md` files keep the old label, as they were written by those runs.
40. The gate's eval used the same local setup as deviations 22 and 29 (ports 8782 and 8120, inspector 9232, `-np 1`, concurrency 1) with the run id suffix `-gate`, and ran in a fresh clone rather than this checkout so that it tested exactly the committed tree after `npm ci`.

## Review findings

Round 1 (2026-10-08): three independent reviews of `21bf1d1` (correctness, security, honesty). Every finding was checked here before acting on it; none was rejected as false.

Correctness:
- (important) The concurrent-approval test never reached the claim race: confirmed (removing `status = 'awaiting_approval'` from the claim passed it). Fixed in `d6e3c25`: barrier tests for a ticket and a booking, which fail under that mutant.
- (important) The R2 test compared only metadata keys: confirmed. Fixed in `a6601b4`; the reviewer's mutant (`audience_rank` "1", `effective_to_ts` 0) fails both new tests.
- (minor) Edit not atomic with the original's state: confirmed with a proxy that approves the original inside the edit's `batch()`. Fixed in `570e69b`.
- (minor) The dev-mode `approvalUrl` test could not see a dropped port: confirmed. Fixed in `2e2d493` (fails when the origin is built from the hostname).
- (minor) "keeps the audit trail of denials" depended on earlier tests: confirmed (`-t` alone failed). Fixed in `836255e`.
- (minor) No test of the agent's `turn_timeout` mapping: confirmed. Fixed in `c349a1c` (fails when it maps to internal).
- (minor) No test that the replaced request does not count toward the limit: confirmed. Fixed in `d6e3c25` (fails with a tautology in place of `id IS NOT ?12`).
- (minor) Two retry layers for Workers AI JSON mode, and `llmCalls` under-counting: confirmed (4 calls). Fixed in `4acc102` (2 calls) and `1c273c5` (cost decided per turn).
- (minor) `category` ignored with AI Search: confirmed. Fixed in `414b7c3`.
- (minor) No test of the eval header path to gateway metadata: confirmed. Fixed in `04c039b` (fails when the header is ignored).
- (minor) The FTS "in sync" test proved little: confirmed. Fixed in `59f30af`; a reseed with the delete trigger dropped makes the integrity check fail (SQLITE_CORRUPT_VTAB, wrangler exits 1). The docsize count alone does not catch that case, so the integrity check is the real assertion.

Security:
- (important) A client holding a user's Access JWT, an MCP client included, can approve: confirmed; the code checks the identity kind and Origin, which a non-browser client sets itself. Fixed by narrowing the claims (`4f4e837`: README lines 3, 28, 78 and the security model, CONTEXT.md, ADR 0005, and a Limitations entry). Not hardened: a separate Access application and audience for `/mcp` would add a config key and a production Access setup that cannot be checked offline, and the reviewer offered narrowing as an alternative. It is recorded as the way to close the gap.
- (minor) `droppedForClearance` sent to callers: confirmed. Fixed in `b938e8f` (deviation 31); CONTEXT.md no longer says the existence of restricted documents is never disclosed, because policy ids are sequential. SPEC section 2 item 5 is left as written (historical spec) and covered by deviation 31.
- (minor) No anti-framing headers on the SPA: confirmed (no `_headers`, no CSP). Fixed in `d514e20`; the README deploy steps now say to set the Access cookie's SameSite to Lax or Strict.
- (minor) Raw internal error strings reached users: confirmed. Fixed in `2e4fac1`.
- (minor) No per-user rate limit, and any caller could set the eval header: confirmed. The eval header part is fixed in `1e57ca4`. The rate limit is not built: a Workers Rate Limiting binding in `wrangler.jsonc` also applies to the Vitest pool, where several test files send dozens of turns for one persona, and the production eval sends 200 turns spread over six personas, so it needs a sizing and exemption decision; it is listed under README Limitations.

Honesty:
- (blocking) The public repo already had the history while PROGRESS said nothing was pushed: confirmed, and it is not something this agent did. See "Coordination notes" for the mirror script and the remote state. The README now maps the cited eval SHAs to the published ones; `summary.json` git SHAs are unchanged. This agent did not stop the mirror (it is the owner's background process, started outside this session) and did not push.
- (important) Published commits have the Co-Authored-By trailer removed: confirmed. The mirror script's header comment says stripping it is the owner's rule for his public repos. Recorded below; whether the public history should carry the trailers is Nitish's decision.
- (important) Unrun scripts listed under "Works today": confirmed. Fixed in `4f4e837` (new "Written, not yet run" row).
- (minor) Opening paragraphs claimed more than was done: confirmed. Fixed in `4f4e837`.
- (minor) Citation precision label: confirmed (118 answer turns with 143 citations in the r2 run; the row counts the 87 grounded-case answer turns and their 87 citations). Fixed in `4dbb375`.
- (minor) Latency cause stated as fact: confirmed. Fixed in `4f4e837`.
- (minor) SPEC.md status line out of date: confirmed. One header line added in `4f4e837`; the rest of the spec is unchanged.
- (minor) Two commits without the trailer: confirmed (`e474ae3`, `ac700fa`, both by the concurrent agent). Recorded below; not reworded.

## Coordination notes

- Another agent works in this same checkout concurrently. It committed `ac700fa` (a README status rewrite) and `e474ae3` (the CI pathspec fix). My commit `cffaf55` (commit 16) accidentally swept that agent's uncommitted README draft in through `git add -A`. Since then: stage explicit paths only, and check `git status` and `git log` before committing.
- Commit 24 merged the README: the spec's section 20 outline plus a current Status table and the other agent's "Why" section.
- Manual UI check on 2026-10-08 with `vite dev` on port 8782: dev login, a cited answer, a chat-proposed ticket approved from its card, the policy viewer and the orientation form all worked against locally seeded data; after the P1 commits, the home page, the manager onboarding view and the dark theme were checked the same way.
- Builder 2's manual pass (2026-10-08, `vite dev` on port 8782, inspector 9232, after `npm run db:reset:local`) as the manager, the tenured employee, the unbooked new hire and HR: form booking for a report, Edit and Update with supersede, a chat booking approved from its card, "approve it" in chat answered with the button instruction, a second approval for an already booked person ending as failed `already_booked`, a report's onboarding by full name and an unknown name refused, a manager-only and a nonexistent policy both "Policy not found", the policy change list, HR's onboarding overview, the dark theme, and phone (375px), tablet (768px) and desktop (1280px) widths. The four UI bugs listed above were found this way and fixed test-first. Local state was reset afterwards.
- The stub router only treats person-referential onboarding phrasings ("Olivia Morgan's onboarding progress", "onboarding for X") as onboarding lookups; "How is X doing with her onboarding?" goes to policy search. That is the deterministic test double working as designed, not a bug; real models route by the prompt.
- The README's Status table and test counts are maintained by hand; refresh them when the test count changes.
- Builder 3 (2026-10-08) ran the second local eval and the CI steps above; the README Status table, Results block and the paragraph under it are current at the last commit.
- GitHub (checked 2026-10-08 17:44 Pacific): `github.com/nitishsjsucs/peopledesk` is public and already carries this history. A background loop outside this repo, `~/Developer/projects/_publish/loop.sh`, runs `_publish/sync.sh peopledesk` every 20 minutes: it copies each new local commit's tree into a separate clone at `~/Developer/projects/_publish/peopledesk`, removes `Co-Authored-By: Claude` trailers from the message (its header comment calls this "Nitish's rule for his public repos"), keeps author and committer dates, and pushes `main`. The trees are identical but every SHA differs; `_publish/peopledesk/.git/sha_map` maps local to published SHAs (for example `7517b30` is `2fa4cc5`, `464103b` is `f93c880`, `2a033dc` is `6cd2b9f`). At 17:42 it had published everything up to `4dbb375` (66 commits, remote `main` at `6004ce5`), and GitHub Actions runs CI on each push: 10 runs by 17:45, the two failures being the earliest (`f10f866`, `a2dcf4a`), and every later run passed, including `6004ce5` (local `4dbb375`, this round's last code commit). Any commit made here is public within about 20 minutes. This agent did not push, did not stop the loop, and did not touch `_publish/`.
- Final verification gate (checked 2026-10-08 17:58 Pacific with `git ls-remote`, read only): GitHub `main` was at `6004ce5` (local `4dbb375`); the mirror loop (`bash ./loop.sh`, running since 14:52) had not yet published `4f4e837` and `eee084a`. Its pass at 18:03 published both (`eee084a` is `4d8ae5b`, which `git ls-remote` then showed as `main`). The orchestrator's brief described the GitHub repo as empty; it is not. The gate did not push and did not touch `_publish/`; its own docs commit will be published by the loop like any other.
- Before relying on SHAs in public docs, Nitish has to choose one history: keep the mirrored one (the README note maps the cited SHAs) or force-push the local one (needs his explicit approval; it would make the cited SHAs resolve on GitHub and carry the trailers).
- Two local commits by the concurrent agent have no Co-Authored-By trailer: `e474ae3` (ci: pass pathspecs after --) and `ac700fa` (docs: README with status...). Every other commit has it. Rewording them would change every later SHA, including those the eval provenance cites, so it belongs to the same history decision; they were left as they are.

## Local machine notes for builders

- Shared ports on this Mac: use `--port 8782 --strictPort` and `INSPECTOR_PORT=9232` for dev or preview servers. For llama-server use port 8120 with `-np 1 -c 8192 -ngl 99` against `~/Developer/projects/_models/Qwen3-1.7B-Q4_0-rtn.gguf` (`node scripts/llm-serve.ts --port 8120 --parallel 1 --ngl 99`), and kill it afterwards.
- `.dev.vars` currently has `LLM_PROVIDER=stub`. To run against the local model: `npm run dev:keys -- --llm-provider openai-compatible --llm-base-url http://127.0.0.1:8120/v1`.
- Do not push; pushing happens after verification. Note that the owner's mirror loop (see "Coordination notes") publishes every local commit to GitHub within about 20 minutes, so never commit a broken tree.
- Under heavy load from the other builds (load average around 20), one run had a single workerd test time out at Vitest's 5 s per-test limit on its first request (`actions.forms-and-csrf.test.ts`, 47 s). The file passed alone in 3.4 s and the full suite passed on the rerun (220 s instead of the usual 30 to 50 s). No timeout was raised and no test was changed; if it recurs, rerun before assuming a regression.
- The Browser pane's `preview_start` reads `.claude/launch.json` from the session's primary directory, which is not this repo; builder 2 ran `INSPECTOR_PORT=9232 npx vite dev --port 8782 --strictPort` in the background instead and stopped it afterwards.
