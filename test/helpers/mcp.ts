// A real MCP client talking to /mcp through SELF.fetch with an Access-shaped JWT, i.e. the full HTTP
// path an external MCP client takes (requireAuth, the agents handler, tool validation).
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { SELF } from "cloudflare:test";
import type { PersonaKey } from "../../src/shared/domain.ts";
import { BASE_URL, tokenFor } from "./http.ts";

export async function mcpClient(who: PersonaKey | string, opts: { token?: string } = {}): Promise<Client> {
  const token = opts.token ?? (await tokenFor(who));
  const client = new Client({ name: "peopledesk-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(url, init);
      const headers = new Headers(request.headers);
      headers.set("Cf-Access-Jwt-Assertion", token);
      // Real HTTP requests always carry Host; SELF.fetch requests do not, and the MCP handler
      // validates it (DNS-rebinding protection).
      headers.set("host", new URL(request.url).host);
      return SELF.fetch(new Request(request, { headers }));
    },
  });
  await client.connect(transport);
  return client;
}

export type ToolResult = {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

export async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

export function errorCode(result: ToolResult): string | undefined {
  return (result.structuredContent?.["error"] as { code?: string } | undefined)?.code;
}
