import { Agent } from "agents";
import { buildApp } from "./app.ts";

export class ConversationAgent extends Agent<Env> {}

const app = buildApp();

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
