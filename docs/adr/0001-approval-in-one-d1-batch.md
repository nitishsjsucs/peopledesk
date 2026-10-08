# 0001: Approvals are a D1 state machine executed in one batch

Status: accepted (2026-10-08)

## Context

The two information-changing tools must never write on their own. A pending action has to wait for its requester, execute exactly once even when two approve requests race, survive a crash at any point without leaving a half-finished record, and leave an audit row that says what really happened. Cloudflare Workflows (a step that waits for an approval event) and a multi-step flow in code (claim, then write, then finalize) were both considered.

## Decision

A pending action is a row in `pending_actions`. Proposals from chat, forms and MCP all go through `ActionService.propose`, whose rate limit (at most 5 awaiting actions per requester) is one conditional `INSERT ... SELECT`, so two concurrent proposals cannot both pass a check-then-insert. `approve` first runs read-only checks in code: the caller is the requester, the identity is a user (ADR 0005), the arguments digest matches, the arguments re-parse, and `can()` passes for the principal reloaded from D1. It then sends one `DB.batch` (one D1 transaction): claim the row with a fresh `claim_id`, write the ticket or booking only if this claim won, finalize the status with a `CASE` over what was actually written, and insert an audit row labeled by that outcome. Every statement after the claim is gated on the `claim_id`.

## Consequences

- No row is ever left in `executing` after a commit, an `action_executed` audit row cannot exist without its ticket or booking, and a losing concurrent approver's batch changes nothing. A retry by the requester replays the stored outcome with `replayed: true`.
- `session_full` and `already_booked` are detected by guards inside the batch rather than by constraint failures; the unique keys stay as backstops.
- Authorization is re-checked in code just before the batch, so a role change landing in the milliseconds between the two is not seen. This window is accepted and documented.
- `arguments_sha256` sits in the same row as the arguments, so it proves integrity (no drift between propose and approve), not tamper resistance. An HMAC was rejected: it adds a production secret and only defends against someone who can already write to D1.
- No Workflows or Queues are needed; the approval is a single HTTP request.
