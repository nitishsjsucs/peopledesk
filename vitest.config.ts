import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import type { TestProjectInlineConfiguration } from "vitest/config";
import { BASE_TEST_VARS, testKeyPair } from "./test/pool-vars.ts";
import type { TestKeys } from "./test/pool-vars.ts";

type Outbound = (keys: TestKeys) => (request: Request) => Response | Promise<Response>;

const workerProject = (
  name: string,
  dir: string,
  vars: Partial<typeof BASE_TEST_VARS>,
  outbound?: Outbound,
): TestProjectInlineConfiguration => ({
  plugins: [
    cloudflareTest(async () => {
      const keys = await testKeyPair();
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            ...BASE_TEST_VARS,
            DEV_ACCESS_JWKS: keys.jwks,
            DEV_ACCESS_PRIVATE_JWK: keys.privateJwk,
            ...vars,
            TEST_MIGRATIONS: await readD1Migrations("migrations"),
            TEST_ACCESS_PRIVATE_JWK: keys.privateJwk,
          },
          ...(outbound ? { outboundService: outbound(keys) } : {}),
        },
      };
    }),
  ],
  test: { name, include: [`test/${dir}/**/*.test.ts`], setupFiles: ["./test/worker-setup.ts"] },
});

// worker-access: the production key path. jose fetches the team JWKS with the global fetch, which
// outboundService intercepts. Every other URL (including the LLM endpoint) answers 599.
const accessOutbound: Outbound = (keys) => (request) => {
  const url = new URL(request.url);
  if (url.origin === "https://team.test" && url.pathname === "/cdn-cgi/access/certs") {
    return new Response(keys.jwks, { headers: { "content-type": "application/json" } });
  }
  return new Response("blocked by test outboundService", { status: 599 });
};

export default defineConfig({
  test: {
    projects: [
      workerProject("worker", "worker", {}),
      workerProject(
        "worker-access",
        "worker-access",
        {
          AUTH_MODE: "access",
          ACCESS_TEAM_DOMAIN: "https://team.test",
          ACCESS_AUD: "test-aud",
          APP_HOSTNAME: "peopledesk.test",
          ALLOW_SERVICE_TOKENS: "true",
          LLM_PROVIDER: "openai-compatible",
          LLM_BASE_URL: "https://llm.test/v1",
        },
        accessOutbound,
      ),
      workerProject("worker-adversarial", "worker-adversarial", { LLM_PROVIDER: "adversarial-stub" }),
      { test: { name: "node", include: ["test/node/**/*.test.ts"], environment: "node" } },
      {
        plugins: [react()],
        test: { name: "web", include: ["test/web/**/*.test.tsx"], environment: "happy-dom", setupFiles: ["./test/web/setup.ts"] },
      },
    ],
  },
});
