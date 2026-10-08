import { Hono } from "hono";
import { PolicyListQuerySchema } from "../../shared/api-types.ts";
import { DOC_ID_RE } from "../../shared/domain.ts";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../hono-env.ts";
import { validate } from "../validation.ts";

// A document above the caller's clearance answers 404 exactly like a document that does not exist,
// so the API never reveals that a restricted document exists.
const notFound = () => new AppError(404, "not_found", "Policy not found.");

export const policyRoutes = new Hono<AppEnv>()
  .get("/policies", validate("query", PolicyListQuerySchema), async (c) => {
    const p = c.get("principal");
    const s = c.get("services");
    const q = c.req.valid("query");
    return c.json({ documents: await s.policies.list(p.clearance, s.clock.asOf(), q) });
  })
  .get("/policies/:docId", async (c) => {
    const docId = c.req.param("docId");
    if (!DOC_ID_RE.test(docId)) throw notFound();
    const s = c.get("services");
    const doc = await s.policies.getDocument(docId, c.get("principal").clearance, s.clock.asOf());
    if (!doc) throw notFound();
    return c.json(doc);
  })
  .get("/policies/:docId/versions/:version", async (c) => {
    const docId = c.req.param("docId");
    const version = Number(c.req.param("version"));
    if (!DOC_ID_RE.test(docId) || !Number.isInteger(version) || version < 1) throw notFound();
    const p = c.get("principal");
    const s = c.get("services");
    const view = await s.policies.getVersion(docId, version, p.clearance, s.clock.asOf());
    if (!view) throw notFound();
    await s.audit.write({ actorId: p.employeeId, event: "policy_viewed", target: `${docId}@${version}`, outcome: "ok" });
    return c.json(view);
  });
