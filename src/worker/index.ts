import { Agent } from "agents";

export class ConversationAgent extends Agent<Env> {}

export default {
  async fetch(): Promise<Response> {
    return Response.json({ error: { code: "not_found", message: "Not found", requestId: "none" } }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
