# 0009: The chat agent calls tools through a real MCP client, in process

Status: accepted (2026-10-08)

## Context

The six tools serve two audiences: the chat agent and external MCP clients. Calling the services directly from the agent would be simpler but would create a second path with its own validation and authorization, and only one of the two would be what external clients get. The Agents SDK's `McpAgent` (a Durable Object per MCP session) is deprecated and feature-frozen in agents 0.27.0.

## Decision

`/mcp` uses the stateless `createMcpHandler` with a per-request factory that binds the verified principal and the services to tool definitions and JSON Schemas computed once per isolate (`src/worker/mcp/tool-defs.ts`). The ConversationAgent connects an `@modelcontextprotocol/client` `Client` over `StreamableHTTPClientTransport` whose injected `fetch` calls the same handler directly with host `mcp.internal` (`src/worker/mcp/in-process-client.ts`), passing the principal as `authInfo`; the real JWT is never placed in `authInfo`. The request forms reach `ActionService.propose` through `POST /api/actions`, the same entry point the write tools use.

## Consequences

- Chat, forms and external clients share one validation and authorization path; strict input schemas, output schemas and audit rows apply to all of them.
- Each chat turn pays for MCP JSON-RPC encoding both ways inside the Worker. Module-scope caching keeps this small, but it adds CPU time, one reason Workers Paid is likely needed (SPEC section 17).
- The MCP packages are pinned exactly at 2.0.0 because agents 0.27.0 pins them as peers.
