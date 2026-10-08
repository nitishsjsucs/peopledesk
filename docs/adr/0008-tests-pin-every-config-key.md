# 0008: Tests pin every config key, and the Worker reads a closed list

Status: accepted (2026-10-08)

## Context

The Workers Vitest integration loads `.dev.vars` into the test runtime, so a developer who switches the dev server to the local model in `.dev.vars` would silently change what the tests run against; a key that exists only in `.dev.vars` leaks through even when other keys are overridden. Config variants (Access mode, the adversarial model) also cannot be switched per test through `SELF`, because the Durable Object reads its own environment. The project standard names `@cloudflare/vitest-pool-workers`, which npm marks as deprecated and renamed.

## Decision

`parseConfig` reads only the keys in `src/worker/config-keys.ts` and ignores everything else. Every workerd Vitest project sets every one of those keys through `miniflare.bindings` from `BASE_TEST_VARS` (`test/pool-vars.ts`, typed `satisfies Record<ConfigKey, string>`, so a new key without a pin is a type error). Config variants get their own project: `worker` (dev auth, stub model), `worker-access` (Access mode, remote JWKS served by `outboundService`, service tokens on) and `worker-adversarial` (adversarial model), next to `node` and `web` (happy-dom). The integration is `@cloudflare/vitest-plugin`, the renamed successor, pinned exactly at 1.3.7.

## Consequences

- `config.pinned.test.ts` proves a local `.dev.vars` cannot change the suite.
- The test runtime uses the wrangler 4.148.0 and Miniflare nested in the plugin, while dev and build use wrangler 4.149.0; the seed round trip runs through the top-level wrangler too, so both runtimes see the same data.
- `wrangler types` also reads `.dev.vars`, so `worker-configuration.d.ts` is generated with `.dev.vars` moved aside, which is what CI checks.
