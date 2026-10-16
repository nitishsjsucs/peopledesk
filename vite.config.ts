import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { loopbackOnly } from "./scripts/lib/loopback-only.ts";

// INSPECTOR_PORT lets a shared machine move the workerd inspector off the default port.
const inspectorPort = process.env.INSPECTOR_PORT ? Number(process.env.INSPECTOR_PORT) : undefined;

export default defineConfig({
  plugins: [loopbackOnly(), react(), cloudflare(inspectorPort === undefined ? {} : { inspectorPort })],
  environments: {
    // The browser bundle only (the Worker's build is the Cloudflare plugin's): the libraries from
    // node_modules (React, React Router, zod) go in their own chunk, loaded in parallel with the app
    // and cached across app changes, which keeps each chunk under Vite's 500 kB warning.
    client: {
      build: {
        rolldownOptions: {
          output: {
            codeSplitting: { groups: [{ name: "vendor", test: /[\\/]node_modules[\\/]/ }] },
          },
        },
      },
    },
  },
});
