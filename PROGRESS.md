# PeopleDesk build progress

This file is the hand-off log for whoever continues the build. SPEC.md (revision 2) is the contract; this file records where the build stands against its commit plan (SPEC section 21).

## Commit plan position

- Done: commits 1 to 5 (scaffold; five Vitest projects; CI; D1 migrations; synth PRNG, UTC dates and org generator).
- Next: commit 6 (synth: archetypes, blueprints, versioned corpus).

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
4. CI's dataset determinism step (`npm run generate && git diff --exit-code ...`) is added in commit 8, when the generator exists.
5. Small helper modules not named in the SPEC file tree: `src/worker/errors.ts` (AppError and the error envelope), `src/worker/hono-env.ts` (Hono context typing), `test/web/setup.ts` (testing-library cleanup).

## Local machine notes for builders

- Shared ports on this Mac: if you start a dev or preview server, use `--port 8782 --strictPort` and `INSPECTOR_PORT=9232`. If an eval needs llama-server, run it on port 8120 with `-np 1 -c 8192 -ngl 99` against `~/Developer/projects/_models/Qwen3-1.7B-Q4_0-rtn.gguf`, and kill it afterwards.
- Do not push; pushing happens after verification.
