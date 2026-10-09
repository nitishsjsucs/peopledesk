// ActionService: the only entry for information-changing actions from chat, forms and MCP.
//
// propose(): zod parse, authorization, business checks, canonical JSON plus a SHA-256 digest, one
// conditional INSERT that enforces the per-requester limit atomically, and an action_proposed audit
// row. Nothing is written to tickets or orientation_bookings.
//
// approve(): read-only checks in JS (owner, human identity, digest, zod re-parse, re-authorization
// against current D1 state), then ONE DB.batch (a single D1 transaction): claim, execute, finalize,
// audit. Every statement after the claim is gated on a fresh claim_id, so a losing concurrent
// approver's batch changes nothing, and no row is ever left in `executing` after a commit.
//
// arguments_sha256 sits in the same row as arguments_json: it detects serialization drift or a
// partial write between propose and approve. It is an integrity check, not a security control:
// anyone who can rewrite the row can rewrite the digest too.
import { canonicalJson } from "../../shared/canonical-json.ts";
import type { PendingActionView } from "../../shared/api-types.ts";
import type { ActionSource, ActionStatus, ToolErrorCode, WriteToolName } from "../../shared/domain.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import type {
  ActionPreview,
  ApprovalRequired,
  CreateSupportTicketArgs,
  ScheduleOrientationSessionArgs,
} from "../../shared/tool-schemas.ts";
import { WRITE_TOOL_INPUTS } from "../../shared/tool-schemas.ts";
import { reloadPrincipal } from "../auth/principal.ts";
import type { Principal } from "../auth/principal.ts";
import { can, clearanceOf } from "../authz/policy.ts";
import type { Clock } from "../clock.ts";
import { AppError } from "../errors.ts";
import { ToolError } from "../mcp/errors.ts";
import { identityOf } from "./audit.ts";
import type { AuditService } from "./audit.ts";
import type { EmployeeService } from "./employees.ts";
import type { OnboardingService } from "./onboarding.ts";
import type { OrientationService } from "./orientation.ts";

export const MAX_PENDING_PER_REQUESTER = 5;

export type ActionRow = {
  id: string;
  tool: WriteToolName;
  requester_id: string;
  subject_employee_id: string;
  conversation_id: string | null;
  source: ActionSource;
  arguments_json: string;
  arguments_sha256: string;
  preview_json: string;
  status: ActionStatus;
  claim_id: string | null;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  decided_by: string | null;
  result_json: string | null;
  error_code: string | null;
  superseded_by: string | null;
};

export type ApproveOutcome =
  | { status: "executed"; result: Record<string, unknown>; replayed: boolean }
  | { status: "failed"; errorCode: string; replayed: boolean };

/** Constructor-only test hook (crash injection). Routes never pass it; no request can set it. */
export type ActionHooks = { afterCommit?: () => void };

export type ActionDeps = {
  db: D1Database;
  clock: Clock;
  audit: AuditService;
  employees: EmployeeService;
  onboarding: OnboardingService;
  orientation: OrientationService;
  ttlSeconds: number;
  hooks?: ActionHooks;
};

const TICKET_CATEGORY_LABEL: Record<CreateSupportTicketArgs["category"], string> = {
  it: "IT",
  payroll: "Payroll",
  benefits: "Benefits",
  facilities: "Facilities",
  hr_general: "HR (general)",
  access_request: "Access request",
};

const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

function issuesText(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues.map((i) => `${i.path.map(String).join(".") || "arguments"}: ${i.message}`).join("; ");
}

export class ActionService {
  private readonly d: ActionDeps;
  constructor(deps: ActionDeps) {
    this.d = deps;
  }

  private get db(): D1Database {
    return this.d.db;
  }

  // ---------------------------------------------------------------------------------------------
  // propose

  async propose(
    principal: Principal,
    tool: WriteToolName,
    rawArgs: unknown,
    source: ActionSource,
    opts: { approvalOrigin: string; conversationId?: string | null; supersedes?: string },
  ): Promise<{ view: PendingActionView; approval: ApprovalRequired }> {
    const parsed = WRITE_TOOL_INPUTS[tool].safeParse(rawArgs);
    if (!parsed.success) throw new ToolError("validation_error", issuesText(parsed.error));
    const args = parsed.data;
    const { subjectEmployeeId, preview } =
      tool === "create_support_ticket"
        ? await this.checkTicket(principal, args as CreateSupportTicketArgs)
        : await this.checkBooking(principal, args as ScheduleOrientationSessionArgs);

    if (opts.supersedes) {
      const old = await this.load(opts.supersedes);
      if (!old || old.requester_id !== principal.employeeId) throw new ToolError("not_found", "The action to replace was not found.");
      if (old.status !== "awaiting_approval" || old.expires_at <= this.d.clock.nowIso()) {
        throw new ToolError("conflict", "Only a request that is still awaiting approval can be edited.");
      }
    }

    const argumentsJson = canonicalJson(args);
    const id = crypto.randomUUID();
    const now = this.d.clock.nowIso();
    const expiresAt = new Date(this.d.clock.nowMs() + this.d.ttlSeconds * 1000).toISOString();
    const statements: D1PreparedStatement[] = [
      // Atomic rate limit: one conditional insert, so two concurrent proposals cannot both pass a
      // check-then-insert. Only non-expired awaiting rows count; the action being replaced does not.
      // An edit also requires, inside the same transaction, that the request it replaces is still
      // awaiting approval: if it was approved or rejected after the JS check above (another tab), the
      // replacement is not created, so one edit can never lead to two executions.
      this.db
        .prepare(
          `INSERT INTO pending_actions (id, tool, requester_id, subject_employee_id, conversation_id, source,
                                        arguments_json, arguments_sha256, preview_json, status, created_at, expires_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'awaiting_approval', ?10, ?11
            WHERE (SELECT COUNT(*) FROM pending_actions
                    WHERE requester_id = ?3 AND status = 'awaiting_approval' AND expires_at > ?10
                      AND id IS NOT ?12) < ${MAX_PENDING_PER_REQUESTER}
              AND (?12 IS NULL OR EXISTS (SELECT 1 FROM pending_actions
                                           WHERE id = ?12 AND requester_id = ?3
                                             AND status = 'awaiting_approval' AND expires_at > ?10))`,
        )
        .bind(
          id,
          tool,
          principal.employeeId,
          subjectEmployeeId,
          opts.conversationId ?? null,
          source,
          argumentsJson,
          sha256Hex(argumentsJson),
          JSON.stringify(preview),
          now,
          expiresAt,
          opts.supersedes ?? null,
        ),
    ];
    if (opts.supersedes) {
      statements.push(
        this.db
          .prepare(
            `UPDATE pending_actions SET status = 'rejected', superseded_by = ?1, decided_at = ?2, decided_by = ?3
              WHERE id = ?4 AND requester_id = ?3 AND status = 'awaiting_approval' AND expires_at > ?2
                AND EXISTS (SELECT 1 FROM pending_actions WHERE id = ?1)`,
          )
          .bind(id, now, principal.employeeId, opts.supersedes),
      );
    }
    statements.push(
      this.db
        .prepare(
          `INSERT INTO audit_log (at, actor_id, event, tool, target, outcome, detail_json)
           SELECT ?1, ?2, 'action_proposed', ?3, ?4, 'ok', ?5 WHERE EXISTS (SELECT 1 FROM pending_actions WHERE id = ?4)`,
        )
        .bind(now, principal.employeeId, tool, id, JSON.stringify({ source, subject: subjectEmployeeId, supersedes: opts.supersedes ?? null, ...identityOf(principal) })),
    );
    const results = await this.db.batch(statements);
    if ((results[0]?.meta.changes ?? 0) === 0) {
      if (opts.supersedes) {
        const old = await this.load(opts.supersedes);
        if (!old || old.status !== "awaiting_approval" || old.expires_at <= now) {
          throw new ToolError("conflict", "The request you were editing was decided or expired in the meantime, so nothing was changed.");
        }
      }
      throw new ToolError(
        "rate_limited",
        `You already have ${MAX_PENDING_PER_REQUESTER} requests awaiting approval. Approve or reject one first.`,
      );
    }
    const row = (await this.load(id)) as ActionRow;
    return {
      view: this.view(row),
      approval: {
        status: "approval_required",
        actionId: id,
        expiresAt,
        preview,
        approvalUrl: `${opts.approvalOrigin}/actions?focus=${id}`,
      },
    };
  }

  private async checkTicket(
    principal: Principal,
    args: CreateSupportTicketArgs,
  ): Promise<{ subjectEmployeeId: string; preview: ActionPreview }> {
    // There is no requester field: the requester is always the principal.
    if (!can(principal, { name: "tickets.create", resource: { requesterId: principal.employeeId } }).allowed) {
      throw new ToolError("forbidden", "You cannot create tickets.");
    }
    if (args.relatedPolicyId) await this.assertPolicyReadable(principal, args.relatedPolicyId);
    const fields = [
      { label: "Requester", value: `${principal.fullName} (${principal.employeeId})` },
      { label: "Category", value: TICKET_CATEGORY_LABEL[args.category] },
      { label: "Subject", value: args.subject },
      { label: "Description", value: args.description },
      { label: "Priority", value: args.priority },
    ];
    if (args.relatedPolicyId) fields.push({ label: "Related policy", value: args.relatedPolicyId });
    return { subjectEmployeeId: principal.employeeId, preview: { title: "New support ticket", fields } };
  }

  private async assertPolicyReadable(principal: Principal, docId: string): Promise<void> {
    const row = await this.db
      .prepare("SELECT audience_rank FROM policy_documents WHERE doc_id = ?1")
      .bind(docId)
      .first<{ audience_rank: number }>();
    if (!row || row.audience_rank > clearanceOf(principal)) {
      throw new ToolError("validation_error", "relatedPolicyId: must be a policy you can read.");
    }
  }

  private async checkBooking(
    principal: Principal,
    args: ScheduleOrientationSessionArgs,
  ): Promise<{ subjectEmployeeId: string; preview: ActionPreview }> {
    const targetId = args.employeeId ?? principal.employeeId;
    const denial = await this.bookingDenial(principal, targetId);
    if (denial) throw new ToolError(denial.code, denial.message);
    const target = await this.d.employees.get(targetId);
    const session = await this.d.orientation.get(args.sessionId);
    if (!session) throw new ToolError("not_found", "No such orientation session.");
    if (session.startsAt.slice(0, 10) <= this.d.clock.asOf()) {
      throw new ToolError("session_in_past", "That session has already started or is in the past.");
    }
    if (await this.d.orientation.isBooked(targetId)) {
      throw new ToolError("already_booked", "This person already has an orientation booking.");
    }
    if (session.seatsRemaining <= 0) throw new ToolError("session_full", "That session is full.");
    const fields = [
      { label: "Attendee", value: `${target?.fullName ?? targetId} (${targetId})` },
      { label: "Session", value: `${session.title} (${session.id})` },
      { label: "Starts", value: utc(session.startsAt) },
      { label: "Location", value: session.location },
      { label: "Seats remaining", value: String(session.seatsRemaining) },
    ];
    if (targetId !== principal.employeeId) fields.push({ label: "Requested by", value: `${principal.fullName} (${principal.employeeId})` });
    return { subjectEmployeeId: targetId, preview: { title: "Book orientation session", fields } };
  }

  /** Self in onboarding; manager for a direct report in onboarding; hr_admin for anyone in onboarding. */
  private async bookingDenial(
    principal: Principal,
    targetId: string,
  ): Promise<{ code: ToolErrorCode; message: string } | null> {
    const outOfScope = {
      code: "forbidden" as const,
      message: "You can only schedule orientation for yourself and the people you support.",
    };
    const target = await this.d.employees.get(targetId);
    if (!target || target.status !== "active") {
      return principal.role === "hr_admin" ? { code: "not_found", message: "No such employee." } : outOfScope;
    }
    const decision = can(principal, {
      name: "orientation.schedule",
      resource: { employeeId: targetId, managerId: target.managerId, inOnboarding: await this.d.onboarding.hasPlan(targetId) },
    });
    if (decision.allowed) return null;
    if (decision.reason === "not_in_onboarding") return { code: "not_in_onboarding", message: "Orientation is only for people in onboarding." };
    return outOfScope;
  }

  // ---------------------------------------------------------------------------------------------
  // approve

  async approve(principal: Principal, actionId: string): Promise<ApproveOutcome> {
    let row = await this.load(actionId);
    if (!row || row.requester_id !== principal.employeeId) throw new AppError(404, "not_found", "Action not found.");
    const decision = can(principal, { name: "action.approve", resource: { requesterId: row.requester_id } });
    if (!decision.allowed) {
      await this.d.audit.write({
        actorId: principal.employeeId,
        event: "authz_denied",
        tool: row.tool,
        target: row.id,
        outcome: decision.reason,
        detail: { route: "approve", ...identityOf(principal) },
      });
      throw new AppError(
        403,
        "human_approval_required",
        "Approval requires a signed-in person. Service tokens can propose and reject, never approve.",
      );
    }
    if (row.status === "executing") row = await this.reconcile(row);
    const settled = await this.settledOutcome(row, principal);
    if (settled) return settled;

    if (sha256Hex(row.arguments_json) !== row.arguments_sha256) {
      throw new AppError(409, "conflict", "The stored request failed its integrity check and was not executed.");
    }
    const parsed = WRITE_TOOL_INPUTS[row.tool].safeParse(JSON.parse(row.arguments_json));
    if (!parsed.success) throw new AppError(409, "conflict", "The stored request no longer validates and was not executed.");

    // Re-authorize against current D1 state. The JS check runs just before the batch, so a role change
    // landing in the milliseconds between the two is not seen (accepted and documented).
    const fresh = await reloadPrincipal(this.db, principal);
    const failure = fresh ? await this.reauthorize(fresh, row.tool, parsed.data) : "forbidden";
    if (failure) return this.finalizeFailed(row, principal, failure);
    return this.execute(row, principal, parsed.data);
  }

  private async reauthorize(
    principal: Principal,
    tool: WriteToolName,
    args: CreateSupportTicketArgs | ScheduleOrientationSessionArgs,
  ): Promise<ToolErrorCode | null> {
    if (tool === "create_support_ticket") {
      const a = args as CreateSupportTicketArgs;
      if (a.relatedPolicyId) {
        try {
          await this.assertPolicyReadable(principal, a.relatedPolicyId);
        } catch {
          return "forbidden";
        }
      }
      return null;
    }
    const a = args as ScheduleOrientationSessionArgs;
    const denial = await this.bookingDenial(principal, a.employeeId ?? principal.employeeId);
    if (denial) return denial.code;
    const session = await this.d.orientation.get(a.sessionId);
    if (!session) return "not_found";
    if (session.startsAt.slice(0, 10) <= this.d.clock.asOf()) return "session_in_past";
    return null; // seats and existing bookings are re-checked inside the batch
  }

  private claim(row: ActionRow, me: string, claimId: string, now: string): D1PreparedStatement {
    return this.db
      .prepare(
        `UPDATE pending_actions SET status = 'executing', claim_id = ?1, decided_at = ?2, decided_by = ?3
          WHERE id = ?4 AND requester_id = ?3 AND status = 'awaiting_approval' AND expires_at > ?2`,
      )
      .bind(claimId, now, me, row.id);
  }

  private async execute(row: ActionRow, principal: Principal, args: unknown): Promise<ApproveOutcome> {
    const me = principal.employeeId;
    const claimId = crypto.randomUUID();
    const now = this.d.clock.nowIso();
    const aid = row.id;
    const statements: D1PreparedStatement[] = [this.claim(row, me, claimId, now)];
    if (row.tool === "create_support_ticket") {
      const a = args as CreateSupportTicketArgs;
      // The aggregate sits in a scalar subquery so the claim gate can filter the single row.
      statements.push(
        this.db
          .prepare(
            `INSERT INTO tickets (id, requester_id, category, subject, description, priority, status, related_policy_id,
                                  created_via, action_id, created_at, updated_at)
             SELECT (SELECT printf('TKT-%06d', COALESCE(MAX(CAST(substr(id, 5) AS INTEGER)), 0) + 1) FROM tickets),
                    ?1, ?2, ?3, ?4, ?5, 'open', ?6, ?7, ?8, ?9, ?9
              WHERE EXISTS (SELECT 1 FROM pending_actions WHERE id = ?8 AND claim_id = ?10 AND status = 'executing')`,
          )
          .bind(me, a.category, a.subject, a.description, a.priority, a.relatedPolicyId ?? null, row.source, aid, now, claimId),
        this.db
          .prepare(
            `UPDATE pending_actions SET
               status = CASE WHEN EXISTS (SELECT 1 FROM tickets WHERE action_id = ?1) THEN 'executed' ELSE 'failed' END,
               error_code = CASE WHEN EXISTS (SELECT 1 FROM tickets WHERE action_id = ?1) THEN NULL ELSE 'conflict' END,
               result_json = CASE WHEN EXISTS (SELECT 1 FROM tickets WHERE action_id = ?1)
                                  THEN json_object('ticketId', (SELECT id FROM tickets WHERE action_id = ?1)) END
             WHERE id = ?1 AND claim_id = ?2 AND status = 'executing'`,
          )
          .bind(aid, claimId),
        this.auditOutcome(aid, claimId, principal, now, "create_support_ticket", "tickets"),
      );
    } else {
      const a = args as ScheduleOrientationSessionArgs;
      const emp = a.employeeId ?? row.subject_employee_id;
      statements.push(
        this.db
          .prepare(
            `INSERT INTO orientation_bookings (id, session_id, employee_id, booked_by, action_id, created_at)
             SELECT 'BKG-' || ?1, ?2, ?3, ?4, ?1, ?5
              WHERE EXISTS (SELECT 1 FROM pending_actions WHERE id = ?1 AND claim_id = ?6 AND status = 'executing')
                AND NOT EXISTS (SELECT 1 FROM orientation_bookings WHERE employee_id = ?3)
                AND (SELECT COUNT(*) FROM orientation_bookings WHERE session_id = ?2)
                    < (SELECT capacity FROM orientation_sessions WHERE id = ?2)`,
          )
          .bind(aid, a.sessionId, emp, me, now, claimId),
        this.db
          .prepare(
            `UPDATE pending_actions SET
               status = CASE WHEN EXISTS (SELECT 1 FROM orientation_bookings WHERE action_id = ?1) THEN 'executed' ELSE 'failed' END,
               error_code = CASE WHEN EXISTS (SELECT 1 FROM orientation_bookings WHERE action_id = ?1) THEN NULL
                                 WHEN EXISTS (SELECT 1 FROM orientation_bookings WHERE employee_id = ?3) THEN 'already_booked'
                                 ELSE 'session_full' END,
               result_json = CASE WHEN EXISTS (SELECT 1 FROM orientation_bookings WHERE action_id = ?1)
                                  THEN json_object('bookingId', (SELECT id FROM orientation_bookings WHERE action_id = ?1),
                                                   'sessionId', ?4) END
             WHERE id = ?1 AND claim_id = ?2 AND status = 'executing'`,
          )
          .bind(aid, claimId, emp, a.sessionId),
        this.auditOutcome(aid, claimId, principal, now, "schedule_orientation_session", "orientation_bookings"),
      );
    }

    let results: D1Result[];
    try {
      results = await this.db.batch(statements);
    } catch (err) {
      // Backstops: UNIQUE(employee_id) and UNIQUE(action_id). If either aborts the batch, nothing was
      // claimed; a follow-up batch claims and finalizes as failed, gated on a new claim id.
      const message = String((err as Error)?.message ?? err);
      if (/UNIQUE constraint failed/i.test(message)) {
        return this.finalizeFailed(row, principal, /orientation_bookings\.employee_id/.test(message) ? "already_booked" : "conflict");
      }
      throw err;
    }
    this.d.hooks?.afterCommit?.();
    if ((results[0]?.meta.changes ?? 0) === 0) return this.afterLostClaim(row.id, principal);
    const final = (await this.load(row.id)) as ActionRow;
    return this.outcomeOf(final, false);
  }

  /** Audit, written only for the winning claim and labeled by what really happened. */
  private auditOutcome(
    aid: string,
    claimId: string,
    principal: Principal,
    now: string,
    tool: WriteToolName,
    table: "tickets" | "orientation_bookings",
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO audit_log (at, actor_id, event, tool, target, outcome, detail_json)
         SELECT ?1, ?2,
                CASE WHEN EXISTS (SELECT 1 FROM ${table} WHERE action_id = ?3) THEN 'action_executed' ELSE 'action_failed' END,
                ?4, ?3, (SELECT COALESCE(error_code, 'ok') FROM pending_actions WHERE id = ?3),
                json_object('claimId', ?5, 'identityKind', ?6, 'identity', ?7)
          WHERE EXISTS (SELECT 1 FROM pending_actions WHERE id = ?3 AND claim_id = ?5)`,
      )
      .bind(now, principal.employeeId, aid, tool, claimId, principal.identityKind, principal.identity);
  }

  private async finalizeFailed(row: ActionRow, principal: Principal, code: ToolErrorCode | string): Promise<ApproveOutcome> {
    const me = principal.employeeId;
    const claimId = crypto.randomUUID();
    const now = this.d.clock.nowIso();
    const results = await this.db.batch([
      this.claim(row, me, claimId, now),
      this.db
        .prepare(
          `UPDATE pending_actions SET status = 'failed', error_code = ?3
            WHERE id = ?1 AND claim_id = ?2 AND status = 'executing'`,
        )
        .bind(row.id, claimId, code),
      this.db
        .prepare(
          `INSERT INTO audit_log (at, actor_id, event, tool, target, outcome, detail_json)
           SELECT ?1, ?2, 'action_failed', ?3, ?4, ?5, json_object('claimId', ?6, 'identityKind', ?7, 'identity', ?8)
            WHERE EXISTS (SELECT 1 FROM pending_actions WHERE id = ?4 AND claim_id = ?6)`,
        )
        .bind(now, me, row.tool, row.id, code, claimId, principal.identityKind, principal.identity),
    ]);
    if ((results[0]?.meta.changes ?? 0) === 0) return this.afterLostClaim(row.id, principal);
    return { status: "failed", errorCode: code, replayed: false };
  }

  private async afterLostClaim(actionId: string, principal: Principal): Promise<ApproveOutcome> {
    let row = (await this.load(actionId)) as ActionRow;
    if (row.status === "executing") row = await this.reconcile(row);
    const settled = await this.settledOutcome(row, principal);
    if (settled) return settled;
    throw new AppError(409, "conflict", "The request changed while it was being approved. Try again.");
  }

  /**
   * Maps a decided row to the response: the requester's retries replay the stored outcome; rejected is
   * 409 not_pending; expired (or awaiting past expires_at, written as expired now) is 410.
   */
  private async settledOutcome(row: ActionRow, principal: Principal): Promise<ApproveOutcome | null> {
    if ((row.status === "executed" || row.status === "failed") && row.decided_by === principal.employeeId) {
      return this.outcomeOf(row, true);
    }
    if (row.status === "executed" || row.status === "failed" || row.status === "rejected") {
      throw new AppError(409, "not_pending", `This request is already ${row.status}.`);
    }
    if (row.status === "expired") throw new AppError(410, "expired", "This request expired before it was approved.");
    if (row.status === "awaiting_approval" && row.expires_at <= this.d.clock.nowIso()) {
      await this.markExpired(row.requester_id);
      throw new AppError(410, "expired", "This request expired before it was approved.");
    }
    return null;
  }

  private outcomeOf(row: ActionRow, replayed: boolean): ApproveOutcome {
    if (row.status === "executed") {
      return { status: "executed", result: JSON.parse(row.result_json ?? "{}") as Record<string, unknown>, replayed };
    }
    return { status: "failed", errorCode: row.error_code ?? "conflict", replayed };
  }

  /**
   * Defensive reconciliation: a row observed in `executing` outside a transaction (it should never be)
   * is resolved from the write tables, with a matching audit row marked reconciled.
   */
  private async reconcile(row: ActionRow): Promise<ActionRow> {
    // The result has the same shape the approval batch writes: { ticketId } or { bookingId, sessionId }.
    const written =
      row.tool === "create_support_ticket"
        ? await this.db
            .prepare("SELECT id, NULL AS session_id FROM tickets WHERE action_id = ?1")
            .bind(row.id)
            .first<{ id: string; session_id: null }>()
        : await this.db
            .prepare("SELECT id, session_id FROM orientation_bookings WHERE action_id = ?1")
            .bind(row.id)
            .first<{ id: string; session_id: string }>();
    const now = this.d.clock.nowIso();
    const status = written ? "executed" : "failed";
    const resultJson = written
      ? JSON.stringify(
          row.tool === "create_support_ticket" ? { ticketId: written.id } : { bookingId: written.id, sessionId: written.session_id },
        )
      : null;
    const res = await this.db
      .prepare(
        `UPDATE pending_actions SET status = ?2, result_json = ?3, error_code = ?4, decided_at = COALESCE(decided_at, ?5)
          WHERE id = ?1 AND status = 'executing'`,
      )
      .bind(row.id, status, resultJson, written ? null : "stale_execution", now)
      .run();
    if (res.meta.changes > 0) {
      await this.d.audit.write({
        actorId: row.decided_by ?? row.requester_id,
        event: written ? "action_executed" : "action_failed",
        tool: row.tool,
        target: row.id,
        outcome: written ? "ok" : "stale_execution",
        detail: { reconciled: true },
      });
    }
    return (await this.load(row.id)) as ActionRow;
  }

  // ---------------------------------------------------------------------------------------------
  // reject, list, read

  async reject(principal: Principal, actionId: string, reason?: string): Promise<{ status: "rejected" }> {
    const row = await this.load(actionId);
    if (!row || !can(principal, { name: "action.reject", resource: { requesterId: row.requester_id } }).allowed) {
      throw new AppError(404, "not_found", "Action not found.");
    }
    const now = this.d.clock.nowIso();
    if (row.status === "awaiting_approval" && row.expires_at <= now) {
      await this.markExpired(row.requester_id);
      throw new AppError(410, "expired", "This request already expired.");
    }
    if (row.status === "expired") throw new AppError(410, "expired", "This request already expired.");
    if (row.status !== "awaiting_approval") throw new AppError(409, "not_pending", `This request is already ${row.status}.`);
    const [update] = await this.db.batch([
      this.db
        .prepare(
          `UPDATE pending_actions SET status = 'rejected', decided_at = ?1, decided_by = ?2
            WHERE id = ?3 AND requester_id = ?2 AND status = 'awaiting_approval' AND expires_at > ?1`,
        )
        .bind(now, principal.employeeId, row.id),
      this.db
        .prepare(
          `INSERT INTO audit_log (at, actor_id, event, tool, target, outcome, detail_json)
           SELECT ?1, ?2, 'action_rejected', ?3, ?4, 'ok', ?5
            WHERE EXISTS (SELECT 1 FROM pending_actions WHERE id = ?4 AND status = 'rejected' AND decided_at = ?1)`,
        )
        .bind(now, principal.employeeId, row.tool, row.id, JSON.stringify({ reason: reason ?? null, ...identityOf(principal) })),
    ]);
    if ((update?.meta.changes ?? 0) === 0) {
      const again = (await this.load(row.id)) as ActionRow;
      if (again.status === "rejected") return { status: "rejected" };
      throw new AppError(409, "not_pending", `This request is already ${again.status}.`);
    }
    return { status: "rejected" };
  }

  async list(principal: Principal, status?: ActionStatus): Promise<PendingActionView[]> {
    await this.markExpired(principal.employeeId);
    const { results } = await this.db
      .prepare(
        `SELECT * FROM pending_actions WHERE requester_id = ?1 AND (?2 IS NULL OR status = ?2)
          ORDER BY created_at DESC, id LIMIT 100`,
      )
      .bind(principal.employeeId, status ?? null)
      .all<ActionRow>();
    return results.map((r) => this.view(r));
  }

  /** Whether the conversation has an action awaiting approval (the chat "approve" guard). */
  async hasPendingInConversation(principal: Principal, conversationId: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1 AS ok FROM pending_actions WHERE requester_id = ?1 AND conversation_id = ?2
            AND status = 'awaiting_approval' AND expires_at > ?3 LIMIT 1`,
      )
      .bind(principal.employeeId, conversationId, this.d.clock.nowIso())
      .first();
    return row !== null;
  }

  async getOwn(principal: Principal, actionId: string): Promise<PendingActionView | null> {
    const row = await this.load(actionId);
    return row && row.requester_id === principal.employeeId ? this.view(row) : null;
  }

  private async markExpired(requesterId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE pending_actions SET status = 'expired'
          WHERE requester_id = ?1 AND status = 'awaiting_approval' AND expires_at <= ?2`,
      )
      .bind(requesterId, this.d.clock.nowIso())
      .run();
  }

  async load(actionId: string): Promise<ActionRow | null> {
    return this.db.prepare("SELECT * FROM pending_actions WHERE id = ?1").bind(actionId).first<ActionRow>();
  }

  view(row: ActionRow): PendingActionView {
    const expired = row.status === "awaiting_approval" && row.expires_at <= this.d.clock.nowIso();
    return {
      actionId: row.id,
      tool: row.tool,
      status: expired ? "expired" : row.status,
      preview: JSON.parse(row.preview_json) as ActionPreview,
      arguments: JSON.parse(row.arguments_json) as unknown,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      source: row.source,
      conversationId: row.conversation_id,
      ...(row.result_json ? { result: JSON.parse(row.result_json) as unknown } : {}),
      ...(row.error_code ? { errorCode: row.error_code } : {}),
      ...(row.superseded_by ? { supersededBy: row.superseded_by } : {}),
    };
  }
}
