import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { isLoopbackAddress, loopbackOnly, loopbackOnlyMiddleware } from "../../scripts/lib/loopback-only.ts";
import viteConfig from "../../vite.config.ts";

function call(remoteAddress: string | undefined): { nextCalled: boolean; status: number | null; body: string } {
  const out = { nextCalled: false, status: null as number | null, body: "" };
  const req = { socket: { remoteAddress }, headers: { host: "localhost" } } as unknown as IncomingMessage;
  const fake = {
    statusCode: 200,
    setHeader: () => undefined,
    end: (chunk?: string) => {
      out.status = fake.statusCode;
      out.body = chunk ?? "";
    },
  };
  const res = fake as unknown as ServerResponse;
  loopbackOnlyMiddleware(req, res, () => {
    out.nextCalled = true;
  });
  return out;
}

describe("loopback-only dev and preview servers", () => {
  it.each(["127.0.0.1", "127.0.1.1", "::1", "::ffff:127.0.0.1"])("passes %s through", (address) => {
    expect(isLoopbackAddress(address)).toBe(true);
    expect(call(address)).toMatchObject({ nextCalled: true, status: null });
  });

  it.each(["10.0.0.160", "192.168.1.20", "::ffff:10.0.0.160", "fe80::1", "128.0.0.1", "127.0.0.1.evil", undefined])(
    "answers 403 to %s whatever its Host header says",
    (address) => {
      expect(isLoopbackAddress(address)).toBe(false);
      const out = call(address);
      expect(out.nextCalled).toBe(false);
      expect(out.status).toBe(403);
      expect(out.body).toMatch(/this machine only/);
    },
  );

  it("registers the guard on both the dev and the preview server, ahead of every other plugin", () => {
    const plugin = loopbackOnly();
    expect(plugin.enforce).toBe("pre");
    for (const hook of [plugin.configureServer, plugin.configurePreviewServer]) {
      const used: unknown[] = [];
      (hook as (s: unknown) => void)({ middlewares: { use: (fn: unknown) => used.push(fn) } });
      expect(used).toEqual([loopbackOnlyMiddleware]);
    }
    const plugins = (viteConfig as { plugins: Array<{ name?: string }> }).plugins;
    expect(plugins[0]?.name).toBe("peopledesk:loopback-only");
  });
});
