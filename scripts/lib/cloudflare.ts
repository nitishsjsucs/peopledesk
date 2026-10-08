// Shared helpers for the scripts that talk to Cloudflare (all need `npx wrangler login` first).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const repo = resolve(import.meta.dirname, "../..");

export function wrangler(args: string[], opts: { capture?: boolean } = {}): string {
  return execFileSync(join(repo, "node_modules/.bin/wrangler"), args, {
    cwd: repo,
    encoding: "utf8",
    stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    env: { ...process.env, CI: "true" },
    maxBuffer: 64 * 1024 * 1024,
  }) as unknown as string;
}

/** Strips // and /* *\/ comments outside strings (enough for wrangler.jsonc). */
export function stripJsonc(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += ch;
  }
  return out;
}

type ProductionEnv = {
  d1_databases: Array<{ binding: string; database_name: string; database_id: string }>;
  r2_buckets: Array<{ binding: string; bucket_name: string }>;
  ai?: { binding: string };
  ai_search?: Array<{ binding: string; instance_name: string }>;
  vars: Record<string, string>;
};

export function productionEnv(): ProductionEnv & { name: string; compatibility_date: string; compatibility_flags: string[] } {
  const cfg = JSON.parse(stripJsonc(readFileSync(join(repo, "wrangler.jsonc"), "utf8"))) as {
    name: string;
    compatibility_date: string;
    compatibility_flags: string[];
    env: { production: ProductionEnv };
  };
  return { ...cfg.env.production, name: cfg.name, compatibility_date: cfg.compatibility_date, compatibility_flags: cfg.compatibility_flags };
}

/**
 * A throwaway wrangler config whose production bindings are marked remote, for getPlatformProxy.
 * The repository's wrangler.jsonc stays local-first (no account-only bindings in the default env).
 */
export function remoteProxyConfig(): string {
  const p = productionEnv();
  if (p.d1_databases.some((d) => d.database_id.startsWith("<"))) {
    throw new Error("Set env.production.d1_databases[0].database_id in wrangler.jsonc first (npx wrangler d1 create peopledesk).");
  }
  const dir = mkdtempSync(join(tmpdir(), "peopledesk-remote-"));
  const path = join(dir, "wrangler.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        name: `${p.name}-scripts`,
        compatibility_date: p.compatibility_date,
        compatibility_flags: p.compatibility_flags,
        r2_buckets: p.r2_buckets.map((b) => ({ ...b, remote: true })),
        ...(p.ai ? { ai: { ...p.ai, remote: true } } : {}),
        ...(p.ai_search ? { ai_search: p.ai_search.map((s) => ({ ...s, remote: true })) } : {}),
      },
      null,
      2,
    ),
  );
  return path;
}
