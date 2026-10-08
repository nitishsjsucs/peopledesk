// An MCP Client over StreamableHTTPClientTransport whose fetch calls the handler directly, so the chat
// agent exercises exactly the validation and authorization path an external MCP client does.
// The host header is mandatory: without it the agents handler answers 403 "Missing Host header".
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { APP_VERSION } from "../../shared/domain.ts";
import { authInfoFor, IN_PROCESS_HOST, mcpHandlerFor } from "./route.ts";
import type { ToolContext } from "./server.ts";

export async function connectInProcess(ctx: ToolContext): Promise<Client> {
  const handler = mcpHandlerFor(ctx);
  const authInfo = authInfoFor(ctx.principal);
  const client = new Client({ name: "peopledesk-chat", version: APP_VERSION });
  const transport = new StreamableHTTPClientTransport(new URL(`http://${IN_PROCESS_HOST}/mcp`), {
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(url, init);
      const headers = new Headers(request.headers);
      headers.set("host", IN_PROCESS_HOST);
      return handler.fetch(new Request(request, { headers }), { authInfo });
    },
  });
  await client.connect(transport);
  return client;
}
