// Seed data has one source, seedStatements(), with two consumers:
// - Worker tests prepare each statement, bind its params and apply them with DB.batch in chunks of 100.
//   They never call D1Database.exec(), which splits on newlines and breaks multi-line markdown.
// - seed.sql (for `wrangler d1 execute --file`) is rendered from the same list by renderSeedSql():
//   params are inlined as SQL literals with ' doubled, and every newline inside a TEXT value becomes
//   ' || char(10) || ' (SQLite has no backslash escapes). Each statement is exactly one line.
import type { Manifest } from "./dataset.ts";
import type { Org } from "./org.ts";

export type SqlParam = string | number | null;
export type SeedStatement = { sql: string; params: SqlParam[] };

const DELETE_ORDER = [
  "audit_log",
  "pending_actions",
  "orientation_bookings",
  "orientation_sessions",
  "onboarding_tasks",
  "onboarding_plans",
  "tickets",
  "conversations",
  "policy_chunks",
  "policy_versions",
  "policy_documents",
] as const;

function insert(table: string, columns: readonly string[], values: SqlParam[]): SeedStatement {
  return {
    sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    params: values,
  };
}

/**
 * Statement order: the dataset_meta row; deletes, children first (D1 enforces foreign keys);
 * employees upserted (managers before reports) so identity_links that map real Access identities
 * survive a reseed; then inserts, parents first. Reseeding clears conversations and pending actions.
 */
export function seedStatements(manifest: Manifest, org: Org): SeedStatement[] {
  const out: SeedStatement[] = [];
  out.push({
    sql:
      "INSERT INTO dataset_meta (id, as_of, valid_until, sha256) VALUES (1, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET as_of = excluded.as_of, valid_until = excluded.valid_until, sha256 = excluded.sha256",
    params: [manifest.asOf, manifest.validUntil, manifest.datasetSha256],
  });
  for (const table of DELETE_ORDER) out.push({ sql: `DELETE FROM ${table}`, params: [] });

  for (const d of manifest.documents) {
    out.push(
      insert("policy_documents", ["doc_id", "title", "category", "audience", "audience_rank", "owner_team"], [
        d.docId,
        d.title,
        d.category,
        d.audience,
        d.rank,
        d.ownerTeam,
      ]),
    );
  }
  for (const d of manifest.documents) {
    for (const v of d.versions) {
      out.push(
        insert(
          "policy_versions",
          ["doc_id", "version", "r2_key", "effective_from", "effective_to", "change_summary", "content_sha256"],
          [d.docId, v.version, v.r2Key, v.effectiveFrom, v.effectiveTo, v.changeSummary, v.contentSha256],
        ),
      );
    }
  }
  let rowid = 0;
  for (const d of manifest.documents) {
    for (const v of d.versions) {
      for (const c of v.chunks) {
        rowid++;
        out.push(
          insert("policy_chunks", ["id", "chunk_id", "doc_id", "version", "ordinal", "title", "section", "text"], [
            rowid,
            c.chunkId,
            d.docId,
            v.version,
            c.ordinal,
            d.title,
            c.section,
            c.text,
          ]),
        );
      }
    }
  }

  const employeeColumns = [
    "id",
    "email",
    "full_name",
    "role",
    "department",
    "region",
    "job_title",
    "manager_id",
    "start_date",
    "status",
  ] as const;
  for (const e of org.employees) {
    const stmt = insert("employees", employeeColumns, [
      e.id,
      e.email,
      e.fullName,
      e.role,
      e.department,
      e.region,
      e.jobTitle,
      e.managerId,
      e.startDate,
      e.status,
    ]);
    stmt.sql += ` ON CONFLICT(id) DO UPDATE SET ${employeeColumns
      .filter((c) => c !== "id")
      .map((c) => `${c} = excluded.${c}`)
      .join(", ")}`;
    out.push(stmt);
  }
  for (const p of org.onboardingPlans) {
    out.push(
      insert("onboarding_plans", ["employee_id", "buddy_id", "start_date", "target_completion_date"], [
        p.employeeId,
        p.buddyId,
        p.startDate,
        p.targetCompletionDate,
      ]),
    );
  }
  for (const t of org.onboardingTasks) {
    out.push(
      insert(
        "onboarding_tasks",
        ["id", "employee_id", "ordinal", "title", "category", "owner_role", "due_date", "status", "completed_at"],
        [t.id, t.employeeId, t.ordinal, t.title, t.category, t.ownerRole, t.dueDate, t.status, t.completedAt],
      ),
    );
  }
  for (const s of org.sessions) {
    out.push(
      insert(
        "orientation_sessions",
        ["id", "title", "starts_at", "duration_min", "format", "region", "location", "capacity", "facilitator_id"],
        [s.id, s.title, s.startsAt, s.durationMin, s.format, s.region, s.location, s.capacity, s.facilitatorId],
      ),
    );
  }
  for (const b of org.bookings) {
    out.push(
      insert("orientation_bookings", ["id", "session_id", "employee_id", "booked_by", "action_id", "created_at"], [
        b.id,
        b.sessionId,
        b.employeeId,
        b.bookedBy,
        null,
        b.createdAt,
      ]),
    );
  }
  for (const t of org.tickets) {
    out.push(
      insert(
        "tickets",
        [
          "id",
          "requester_id",
          "category",
          "subject",
          "description",
          "priority",
          "status",
          "related_policy_id",
          "created_via",
          "action_id",
          "created_at",
          "updated_at",
        ],
        [
          t.id,
          t.requesterId,
          t.category,
          t.subject,
          t.description,
          t.priority,
          t.status,
          t.relatedPolicyId,
          t.createdVia,
          null,
          t.createdAt,
          t.updatedAt,
        ],
      ),
    );
  }
  return out;
}

/** A SQL literal: NULL, a number, or a quoted string with newlines written as char(10). */
export function sqlLiteral(value: SqlParam): string {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`non-finite number in seed: ${value}`);
    return String(value);
  }
  if (value.includes("\r")) throw new Error("seed text must not contain carriage returns");
  return value
    .split("\n")
    .map((part) => `'${part.replace(/'/g, "''")}'`)
    .join(" || char(10) || ");
}

/** Inlines params into one statement per line. Placeholders are the `?` characters of the SQL text. */
export function renderSeedSql(statements: readonly SeedStatement[]): string {
  const lines = statements.map((s) => {
    let i = 0;
    const sql = s.sql.replace(/\?/g, () => {
      if (i >= s.params.length) throw new Error(`too few params for: ${s.sql}`);
      return sqlLiteral(s.params[i++] as SqlParam);
    });
    if (i !== s.params.length) throw new Error(`too many params for: ${s.sql}`);
    return `${sql};`;
  });
  return `${lines.join("\n")}\n`;
}
