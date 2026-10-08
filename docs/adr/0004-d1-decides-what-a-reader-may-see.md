# 0004: D1 decides what a reader may see, whatever the retriever returns

Status: accepted (2026-10-08)

## Context

There are two retrievers: AI Search over R2 in production and SQLite FTS5 locally. Both can filter by clearance and effective dates, but AI Search filters depend on R2 custom metadata reaching the index, which the documentation does not confirm, and AI Search returns an empty result on failure by default. A broken filter would then either leak restricted passages or turn every question into a refusal that looks correct.

## Decision

Retriever filters are an optimization, not the guarantee. `PermissionGate` (`src/worker/policies/permission-gate.ts`) loads the distinct document versions of the returned passages from D1 in one query and drops every passage above the caller's clearance or not effective at the business date, reporting both counts in the turn trace. AI Search requests send `return_on_failure: false`, so a retrieval failure throws and the turn returns an error (`retrieval_unavailable`), never a refusal. "Not found" and "not permitted" produce the same refusal text, and the document API answers 404 for documents above the caller's clearance.

## Consequences

- Both retrievers are equally safe even when a filter is misconfigured; `retrieval.permission-gate.test.ts` feeds the gate restricted, superseded and scheduled passages from a fake retriever.
- A broken index shows up as error turns and as zero-passage answerable cases, and the eval aborts when more than 5 answerable cases retrieve nothing, so unauthorized cases cannot pass for the wrong reason.
- If R2 custom metadata does not reach AI Search, the documented fallback is a folder-range filter on the `policies/r<rank>-...` key prefix; `npm run verify:ai-search` reports which mode works.
