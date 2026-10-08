import type { Ticket } from "../../shared/api-types.ts";
import type { TicketStatus } from "../../shared/domain.ts";

type Row = {
  id: string;
  requester_id: string;
  category: Ticket["category"];
  subject: string;
  description: string;
  priority: Ticket["priority"];
  status: TicketStatus;
  related_policy_id: string | null;
  created_via: Ticket["createdVia"];
  created_at: string;
  updated_at: string;
};

export const toTicket = (r: Row): Ticket => ({
  id: r.id,
  requesterId: r.requester_id,
  category: r.category,
  subject: r.subject,
  description: r.description,
  priority: r.priority,
  status: r.status,
  relatedPolicyId: r.related_policy_id,
  createdVia: r.created_via,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class TicketService {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  /** The caller's own tickets. There is no parameter that can name another person. */
  async listOwn(requesterId: string, opts: { status?: TicketStatus; limit?: number } = {}): Promise<Ticket[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM tickets WHERE requester_id = ?1 AND (?2 IS NULL OR status = ?2)
          ORDER BY created_at DESC, id DESC LIMIT ?3`,
      )
      .bind(requesterId, opts.status ?? null, opts.limit ?? 200)
      .all<Row>();
    return results.map(toTicket);
  }
}
