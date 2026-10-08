import type { Session } from "../../shared/api-types.ts";
import type { SessionFormat, SessionRegion } from "../../shared/domain.ts";
import { addDaysIso } from "../../shared/dates.ts";

type Row = {
  id: string;
  title: string;
  starts_at: string;
  duration_min: number;
  format: SessionFormat;
  region: SessionRegion;
  location: string;
  capacity: number;
  booked: number;
};

export const DEFAULT_SESSION_WINDOW_DAYS = 60;

const toSession = (r: Row): Session => ({
  id: r.id,
  title: r.title,
  startsAt: r.starts_at,
  durationMin: r.duration_min,
  format: r.format,
  region: r.region,
  location: r.location,
  capacity: r.capacity,
  seatsRemaining: Math.max(0, r.capacity - r.booked),
});

const SELECT = `SELECT s.*, (SELECT COUNT(*) FROM orientation_bookings b WHERE b.session_id = s.id) AS booked
                  FROM orientation_sessions s`;

export class OrientationService {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  /** Sessions starting in [from, to] (dates inclusive); defaults to asOf .. asOf + 60 days. */
  async list(
    asOf: string,
    filter: { from?: string; to?: string; format?: SessionFormat; region?: SessionRegion } = {},
  ): Promise<Session[]> {
    const from = filter.from ?? asOf;
    const to = filter.to ?? addDaysIso(asOf, DEFAULT_SESSION_WINDOW_DAYS);
    const { results } = await this.db
      .prepare(
        `${SELECT} WHERE substr(s.starts_at, 1, 10) >= ?1 AND substr(s.starts_at, 1, 10) <= ?2
           AND (?3 IS NULL OR s.format = ?3) AND (?4 IS NULL OR s.region = ?4)
         ORDER BY s.starts_at, s.id`,
      )
      .bind(from, to, filter.format ?? null, filter.region ?? null)
      .all<Row>();
    return results.map(toSession);
  }

  async get(sessionId: string): Promise<Session | null> {
    const row = await this.db.prepare(`${SELECT} WHERE s.id = ?1`).bind(sessionId).first<Row>();
    return row ? toSession(row) : null;
  }

  async isBooked(employeeId: string): Promise<boolean> {
    return (await this.db.prepare("SELECT 1 AS ok FROM orientation_bookings WHERE employee_id = ?1").bind(employeeId).first()) !== null;
  }
}
