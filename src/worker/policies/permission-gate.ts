// Re-checks every retrieved passage against D1, whatever the retriever returned: drops anything above
// the caller's clearance or not effective at asOf, and overwrites effective dates and the source key
// with D1's values. This makes both retrievers equally safe even if a retriever filter is wrong.
import type { Clearance } from "../../shared/domain.ts";
import { isEffective } from "../../shared/dates.ts";
import type { RetrievedPassage } from "./retriever.ts";

export type D1Chunk = { chunkId: string; docId: string; version: number; ordinal: number; section: string; text: string };

export type GateResult = {
  passages: RetrievedPassage[];
  droppedForClearance: number;
  /** Includes passages whose (doc, version) does not exist in D1 at all. */
  droppedNotEffective: number;
  /** D1 chunks of the surviving versions, keyed "docId@version" (only when requested; used by chunk-align). */
  chunksByVersion: Map<string, D1Chunk[]>;
};

type VersionRow = {
  doc_id: string;
  version: number;
  effective_from: string;
  effective_to: string | null;
  r2_key: string;
  title: string;
  audience_rank: Clearance;
};

export const versionKey = (docId: string, version: number) => `${docId}@${version}`;

export class PermissionGate {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  async filter(
    passages: readonly RetrievedPassage[],
    clearance: Clearance,
    asOf: string,
    opts: { withChunks?: boolean } = {},
  ): Promise<GateResult> {
    const keys = [...new Set(passages.map((p) => versionKey(p.docId, p.version)))];
    const result: GateResult = { passages: [], droppedForClearance: 0, droppedNotEffective: 0, chunksByVersion: new Map() };
    if (keys.length === 0) return result;
    const placeholders = keys.map(() => "?").join(",");
    const versionsStmt = this.db
      .prepare(
        `SELECT v.doc_id, v.version, v.effective_from, v.effective_to, v.r2_key, d.title, d.audience_rank
           FROM policy_versions v JOIN policy_documents d ON d.doc_id = v.doc_id
          WHERE v.doc_id || '@' || v.version IN (${placeholders})`,
      )
      .bind(...keys);
    const statements = [versionsStmt];
    if (opts.withChunks) {
      statements.push(
        this.db
          .prepare(
            `SELECT chunk_id, doc_id, version, ordinal, section, text FROM policy_chunks
              WHERE doc_id || '@' || version IN (${placeholders}) ORDER BY doc_id, version, ordinal`,
          )
          .bind(...keys),
      );
    }
    // One round trip (a read-only batch).
    const [versions, chunks] = await this.db.batch(statements);
    const truth = new Map<string, VersionRow>();
    for (const row of (versions?.results ?? []) as VersionRow[]) truth.set(versionKey(row.doc_id, row.version), row);

    const surviving = new Set<string>();
    for (const p of passages) {
      const key = versionKey(p.docId, p.version);
      const v = truth.get(key);
      if (!v) {
        result.droppedNotEffective++;
        continue;
      }
      if (v.audience_rank > clearance) {
        result.droppedForClearance++;
        continue;
      }
      if (!isEffective({ effectiveFrom: v.effective_from, effectiveTo: v.effective_to }, asOf)) {
        result.droppedNotEffective++;
        continue;
      }
      surviving.add(key);
      result.passages.push({
        ...p,
        title: v.title,
        effectiveFrom: v.effective_from,
        effectiveTo: v.effective_to,
        sourceKey: v.r2_key,
      });
    }
    if (opts.withChunks) {
      type ChunkRow = { chunk_id: string; doc_id: string; version: number; ordinal: number; section: string; text: string };
      for (const c of (chunks?.results ?? []) as ChunkRow[]) {
        const key = versionKey(c.doc_id, c.version);
        if (!surviving.has(key)) continue;
        const list = result.chunksByVersion.get(key) ?? [];
        list.push({ chunkId: c.chunk_id, docId: c.doc_id, version: c.version, ordinal: c.ordinal, section: c.section, text: c.text });
        result.chunksByVersion.set(key, list);
      }
    }
    return result;
  }
}
