import { buildApp } from "./app.ts";

export { ConversationAgent } from "./chat/agent.ts";

// Built once per isolate.
const app = buildApp();

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
