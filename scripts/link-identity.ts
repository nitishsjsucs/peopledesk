// npm run link-identity -- (--remote | --local) (--email <access email> | --service-token <common_name>) --employee E0001
// Maps a real Cloudflare Access identity (a user email, or a service token's common_name) onto a seeded
// employee by inserting an identity_links row. Only a user identity can ever approve actions.
import { parseArgs } from "node:util";
import { sqlLiteral } from "../src/shared/synth/seed-sql.ts";
import { wrangler } from "./lib/cloudflare.ts";

const { values } = parseArgs({
  options: {
    remote: { type: "boolean", default: false },
    local: { type: "boolean", default: false },
    email: { type: "string" },
    "service-token": { type: "string" },
    employee: { type: "string" },
  },
});
const employee = values.employee ?? "";
const email = values.email?.trim().toLowerCase();
const commonName = values["service-token"]?.trim();
if (values.remote === values.local || !/^E\d{4}$/.test(employee) || !!email === !!commonName) {
  console.error("usage: npm run link-identity -- (--remote | --local) (--email EMAIL | --service-token COMMON_NAME) --employee E0001");
  process.exit(2);
}
if (email && !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
  console.error("not a valid email address");
  process.exit(2);
}
if (commonName && !/^[A-Za-z0-9._-]{1,200}$/.test(commonName)) {
  console.error("service token common_name may contain letters, digits, '.', '_' and '-' only");
  process.exit(2);
}
const identity = (email ?? commonName) as string;
const kind = email ? "email" : "service_token";
const sql =
  `INSERT INTO identity_links (identity, kind, employee_id, created_at) VALUES (${sqlLiteral(identity)}, ${sqlLiteral(kind)}, ` +
  `${sqlLiteral(employee)}, ${sqlLiteral(new Date().toISOString())}) ON CONFLICT(identity) DO UPDATE SET kind = excluded.kind, ` +
  "employee_id = excluded.employee_id";
wrangler(["d1", "execute", "peopledesk", values.remote ? "--remote" : "--local", ...(values.remote ? ["--env", "production"] : []), "--command", sql]);
console.log(`Linked ${kind} ${identity} -> ${employee} (${values.remote ? "remote" : "local"})`);
