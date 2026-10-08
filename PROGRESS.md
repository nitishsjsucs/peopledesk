# PeopleDesk build progress

This file is the hand-off log for whoever continues the build. SPEC.md (revision 2) is the contract; this file records where the build stands against its commit plan (SPEC section 21).

## Commit plan position

- Done: commits 1 to 9 (scaffold; five Vitest projects; CI; D1 migrations; synth org; archetypes, blueprints and versioned corpus; disjointness, rendering, chunking; seed statements, seed.sql and the committed asof-2026-10-01 dataset; local seeding and batch-based worker test setup).
- Next: commit 10 (auth: JWT verifier, principal resolution, dev issuer).

## Status at the last commit

- `npm run typecheck`: pass
- `npm test`: pass (6 files, 20 tests across all five projects)
- `npm run deploy:check`: pass (offline dry run lists DB, POLICY_BUCKET, CONVERSATION_AGENT, AI, POLICY_SEARCH)
- `npx wrangler types --strict-vars false --check`: pass
- `npm run build`: pass

## Deviations from SPEC.md

1. `vite.config.ts` reads an optional `INSPECTOR_PORT` env var and passes it to `cloudflare({ inspectorPort })`. Reason: this Mac builds several repos at once and the default workerd inspector port can collide. Without the variable the plugin default applies, so the spec's behavior is unchanged.
2. Commit 1 includes a minimal `vitest.config.ts` (node project only) and `test/node/toolchain.test.ts` (exact pins, ESM package, .nvmrc). Reason: every commit must leave `npm test` green, and `vitest run` with no test files exits non-zero. Commit 2 replaces the config with the five-project shape.
3. Until auth lands (commit 10), `/api/health` is served without a token so the pinned-config tests can run. Commit 10 puts it behind `requireAuth` as SPEC section 8 says.
4. CI's dataset determinism step (`npm run generate && git diff --exit-code ...`) was added in commit 8, when the generator existed.
8. `src/shared/synth/dataset.ts` (not in the SPEC file tree) builds the manifest, org and markdown files in memory; `scripts/generate.ts` writes them, and tests build them in memory. `src/shared/sha256.ts` is a synchronous pure-TS SHA-256 so the generator stays synchronous and identical on every runtime. `scripts/generate.ts` also accepts `--out <dir>` so the timezone determinism test can generate into a temp directory.
9. The manifest carries every chunk's text (the spec asks seed.counts to compare D1 chunk text with "the manifest chunk text"), which makes `manifest.json` about 500 KB.
6. Restricted-value disjointness versus the archetype bands (SPEC section 12). The spec's rank 2 and rank 3 bands for `count_per_year` (13-24, 25-36) and `notice_weeks` (13-20, 21-30) are almost entirely covered by numbers that rank 1 documents already contain (days 3-60, hours 1-40, percents 1-25 in half steps, review cadences 6/12/18/24). Measured on the committed seed: `count_per_year` rank 2 had 1 free value of 12 and rank 3 had 0, `notice_weeks` likewise. The mandated resampling therefore threw ("could not draw an acceptable count_per_year value for POL-098.f1@v2"). Resolution: the bands stay exactly as specified, the generator still enforces disjointness and throws when it cannot, and the 17 restricted blueprint facts that used those two archetypes were re-authored onto archetypes whose restricted bands are feasible (days, hours, money, percent). `count_per_year` and `notice_weeks` are used by `all` documents only; a test pins that rule.
7. Number normalization lives in `evals/lib/normalize.ts` as the spec's file tree says, and `src/shared/synth/corpus.ts` imports it, so the generator's N(r) and the scorer and leak check share one normalizer.
5. Small helper modules not named in the SPEC file tree: `src/worker/errors.ts` (AppError and the error envelope), `src/worker/hono-env.ts` (Hono context typing), `test/web/setup.ts` (testing-library cleanup).

## Local machine notes for builders

- Shared ports on this Mac: if you start a dev or preview server, use `--port 8782 --strictPort` and `INSPECTOR_PORT=9232`. If an eval needs llama-server, run it on port 8120 with `-np 1 -c 8192 -ngl 99` against `~/Developer/projects/_models/Qwen3-1.7B-Q4_0-rtn.gguf`, and kill it afterwards.
- Do not push; pushing happens after verification.
