# 0010: One Durable Object per conversation, reached over RPC only

Status: accepted (2026-10-08)

## Context

A conversation needs its transcript and per-turn traces stored next to the code that runs the turn, and a second message must not start a turn while one is in flight. A stateless route with the transcript in D1 would need its own locking; WebSocket state sync (`useAgent`) and token streaming add moving parts the v1 UI does not need.

## Decision

`ConversationAgent` (Agents SDK, SQLite storage) is named `<employeeId>:<conversationId>` by the Worker after it has verified the principal and checked that the conversation row in D1 belongs to them; every RPC method checks the principal against the name again. It keeps no Agent state: messages and traces live in its SQLite tables, and open actions are read from D1. A `TurnLock` allows one turn at a time, is released in `finally` on every path, and aborts a turn after 60 seconds through an `AbortSignal` passed to every model call and retrieval. A turn returns one JSON turn result over Worker RPC; there is no WebSocket and no streaming.

## Consequences

- A second message during a turn gets 409 `turn_in_progress`. Because an exception thrown across Durable Object RPC is logged as uncaught on every 409, `sendMessage` returns `{ ok: false, code: "turn_in_progress" }` instead (PROGRESS.md, deviation 15).
- The UI shows a progress state instead of streamed tokens.
- Conversation contents are not queryable in D1; only conversation ownership and pending actions are.
