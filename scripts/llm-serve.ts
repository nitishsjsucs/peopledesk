// npm run llm:serve -- [--model PATH] [--port 8080] [--parallel 2] [--ngl N]
// Starts llama-server with the pinned flags for local evals (Qwen3-1.7B Q4_0, OpenAI-compatible API,
// thinking disabled, temperature 0). Point the dev server at it with:
//   npm run dev:keys -- --llm-provider openai-compatible --llm-base-url http://127.0.0.1:<port>/v1
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    model: { type: "string", default: join(homedir(), "Developer/projects/_models/Qwen3-1.7B-Q4_0-rtn.gguf") },
    port: { type: "string", default: "8080" },
    parallel: { type: "string", default: "2" },
    ngl: { type: "string" },
  },
});
const model = values.model as string;
if (!existsSync(model)) {
  console.error(`model not found: ${model}`);
  process.exit(1);
}
const args = [
  "-m", model,
  "--host", "127.0.0.1",
  "--port", values.port as string,
  "-c", "8192",
  "--jinja",
  "--reasoning-budget", "0",
  "-np", values.parallel as string,
  "--temp", "0",
  ...(values.ngl ? ["-ngl", values.ngl] : []),
];
console.log(`llama-server ${args.join(" ")}`);
const child = spawn("llama-server", args, { stdio: "inherit" });
const stop = () => child.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
