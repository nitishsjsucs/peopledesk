# PeopleDesk build progress

This file is the hand-off log for whoever continues the build. SPEC.md (revision 2) is the contract; this file records where the build stands against its commit plan (SPEC section 21).

## Commit plan position

- Done: commit 1 (scaffold).
- Next: commit 2 (five Vitest projects with pinned config vars and outbound JWKS handler).

## Status at the last commit

- `npm run typecheck`: pass
- `npm test`: pass (1 file, 4 tests; node project only so far)
- `npm run build`: pass

## Deviations from SPEC.md

1. `vite.config.ts` reads an optional `INSPECTOR_PORT` env var and passes it to `cloudflare({ inspectorPort })`. Reason: this Mac builds several repos at once and the default workerd inspector port can collide. Without the variable the plugin default applies, so the spec's behavior is unchanged.
2. Commit 1 includes a minimal `vitest.config.ts` (node project only) and `test/node/toolchain.test.ts` (exact pins, ESM package, .nvmrc). Reason: every commit must leave `npm test` green, and `vitest run` with no test files exits non-zero. Commit 2 replaces the config with the five-project shape.

## Local machine notes for builders

- Shared ports on this Mac: if you start a dev or preview server, use `--port 8782 --strictPort` and `INSPECTOR_PORT=9232`. If an eval needs llama-server, run it on port 8120 with `-np 1 -c 8192 -ngl 99` against `~/Developer/projects/_models/Qwen3-1.7B-Q4_0-rtn.gguf`, and kill it afterwards.
- Do not push; pushing happens after verification.
