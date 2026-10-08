import type { AuditEvent } from "../../shared/domain.ts";

export type AuditEntry = {
  actorId: string;
  event: AuditEvent;
  tool?: string | null;
  target?: string | null;
  outcome: string;
  detail?: Record<string, unknown>;
};

export class AuditService {
  private readonly db: D1Database;
  private readonly now: () => string;
  constructor(db: D1Database, now: () => string) {
    this.db = db;
    this.now = now;
  }

  statement(e: AuditEntry): D1PreparedStatement {
    return this.db
      .prepare(
        "INSERT INTO audit_log (at, actor_id, event, tool, target, outcome, detail_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      )
      .bind(this.now(), e.actorId, e.event, e.tool ?? null, e.target ?? null, e.outcome, JSON.stringify(e.detail ?? {}));
  }

  async write(e: AuditEntry): Promise<void> {
    await this.statement(e).run();
  }
}
