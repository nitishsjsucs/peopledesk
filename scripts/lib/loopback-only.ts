// The local dev and preview servers answer only connections from this machine. Dev mode's hostname
// guard (src/worker/app.ts) reads the request URL, which the Vite plugin builds from the client's Host
// header, so on a server exposed with `--host` anyone on the network could send `Host: localhost`
// and reach /dev/token. The TCP peer address cannot be spoofed that way.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === "::1" || /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i.test(address);
}

export function loopbackOnlyMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  if (isLoopbackAddress(req.socket.remoteAddress)) {
    next();
    return;
  }
  res.statusCode = 403;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end("PeopleDesk's local servers accept connections from this machine only.\n");
}

/** Registered before every other plugin's middleware, for `vite dev` and `vite preview`. */
export function loopbackOnly(): Plugin {
  return {
    name: "peopledesk:loopback-only",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(loopbackOnlyMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(loopbackOnlyMiddleware);
    },
  };
}
