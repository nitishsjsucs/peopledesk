// A D1Database stand-in over node:sqlite, for the CPU profile (scripts/cpu-profile.ts). It implements
// only what the Worker calls: prepare().bind().first()/all()/run() and batch(). Time spent inside it
// goes to an I/O meter, because in production a D1 query is awaited I/O, not Worker CPU; it also
// counts statements, for the Workers Free plan's limit on D1 queries per invocation.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

/** depth > 0 means the caller is already inside a metered stand-in, which accounts for this time. */
export type IoMeter = { cpuMs: number; d1Statements: number; d1Calls: number; depth: number };

/** CPU time of the calling thread, in ms (user plus system), not wall-clock time. */
export function threadCpuMs(): number {
  const u = process.threadCpuUsage();
  return (u.user + u.system) / 1000;
}

type Value = string | number | boolean | null | undefined | bigint;

function toSqlite(v: Value): SQLInputValue {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

export class NodeD1Statement {
  private readonly owner: NodeD1;
  readonly sql: string;
  private readonly params: Value[];

  constructor(owner: NodeD1, sql: string, params: Value[]) {
    this.owner = owner;
    this.sql = sql;
    this.params = params;
  }

  bind(...params: Value[]): NodeD1Statement {
    return new NodeD1Statement(this.owner, this.sql, params);
  }

  /** Runs the statement and returns rows plus D1-shaped meta (no meter: callers meter). */
  execute(): { results: Record<string, unknown>[]; meta: { changes: number; last_row_id: number }; success: true } {
    const stmt = this.owner.db.prepare(this.sql);
    const args = this.params.map(toSqlite);
    if (stmt.columns().length > 0) {
      const rows = stmt.all(...args) as Record<string, unknown>[];
      return { results: rows.map((r) => ({ ...r })), meta: { changes: /^\s*select/i.test(this.sql) ? 0 : rows.length, last_row_id: 0 }, success: true };
    }
    const r = stmt.run(...args);
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) }, success: true };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const r = this.owner.metered(1, () => this.execute());
    const row = r.results[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; meta: { changes: number; last_row_id: number }; success: true }> {
    return this.owner.metered(1, () => this.execute()) as { results: T[]; meta: { changes: number; last_row_id: number }; success: true };
  }

  async run(): Promise<{ results: unknown[]; meta: { changes: number; last_row_id: number }; success: true }> {
    return this.owner.metered(1, () => this.execute());
  }
}

export class NodeD1 {
  readonly db: DatabaseSync;
  readonly meter: IoMeter;

  constructor(meter: IoMeter) {
    this.db = new DatabaseSync(":memory:");
    this.meter = meter;
  }

  metered<T>(statements: number, fn: () => T): T {
    if (this.meter.depth > 0) return fn();
    const c0 = threadCpuMs();
    try {
      return fn();
    } finally {
      this.meter.cpuMs += threadCpuMs() - c0;
      this.meter.d1Statements += statements;
      this.meter.d1Calls += 1;
    }
  }

  prepare(sql: string): NodeD1Statement {
    return new NodeD1Statement(this, sql, []);
  }

  /** One transaction, like D1. */
  async batch(statements: NodeD1Statement[]) {
    return this.metered(statements.length, () => {
      this.db.exec("BEGIN");
      try {
        const out = statements.map((s) => s.execute());
        this.db.exec("COMMIT");
        return out;
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    });
  }

  /** Applies migrations/*.sql in order (outside the meter). */
  migrate(dir: string): void {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) this.db.exec(readFileSync(join(dir, f), "utf8"));
  }
}
