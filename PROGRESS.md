# PeopleDesk build progress

This file is the hand-off log for whoever continues the build. SPEC.md (revision 2) is the contract; this file records where the build stands against its commit plan (SPEC section 21).

## Commit plan position

- Done: commits 1 to 15 (scaffold; five Vitest projects; CI; D1 migrations; synth org; archetypes, blueprints and versioned corpus; disjointness, rendering, chunking; seed statements, seed.sql and the committed asof-2026-10-01 dataset; local seeding and batch-based worker test setup; auth with local and remote JWKS, principal resolution and the dev issuer; authz capability matrix; PolicyStore, D1 FTS5 retriever and permission gate; AI Search adapter and chunk alignment; read routes for policies, tickets, onboarding, orientation and team; MCP server with cached tool definitions, the four read tools, /mcp and the in-process client).
- Next: commit 16 (ActionService single-batch approval, atomic rate limit, the two write tools, approval endpoints, crash-after-commit test).
- Open item carried forward: `retrieval.ai-search-adapter.test.ts` still needs the case "a throwing fake makes the chat turn return kind error with retrieval_unavailable"; it needs the orchestrator (commit 18).

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

## Local machine notes for builders

- Shared ports on this Mac: if you start a dev or preview server, use `--port 8782 --strictPort` and `INSPECTOR_PORT=9232`. If an eval needs llama-server, run it on port 8120 with `-np 1 -c 8192 -ngl 99` against `~/Developer/projects/_models/Qwen3-1.7B-Q4_0-rtn.gguf`, and kill it afterwards.
- Do not push; pushing happens after verification.
