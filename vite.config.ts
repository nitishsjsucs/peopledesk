import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// INSPECTOR_PORT lets a shared machine move the workerd inspector off the default port.
const inspectorPort = process.env.INSPECTOR_PORT ? Number(process.env.INSPECTOR_PORT) : undefined;

export default defineConfig({
  plugins: [react(), cloudflare(inspectorPort === undefined ? {} : { inspectorPort })],
});
