// Local and test retriever (and a production fallback via RETRIEVER=d1-fts): FTS5 + bm25 with the
// clearance and effective-date filters applied in SQL. All 155 versions are indexed; filtering at
// query time is the mechanism under test.
import type { PolicyRetriever, RetrievalRequest, RetrievedPassage } from "./retriever.ts";
import { RetrievalError } from "./retriever.ts";
import { toFtsQuery } from "./fts-query.ts";

const SQL = `
SELECT c.chunk_id, c.doc_id, c.version, c.title, c.section, c.text,
       v.effective_from, v.effective_to, v.r2_key,
       bm25(policy_chunks_fts, 8.0, 3.0, 1.0) AS score
FROM policy_chunks_fts
JOIN policy_chunks c ON c.id = policy_chunks_fts.rowid
JOIN policy_versions v ON v.doc_id = c.doc_id AND v.version = c.version
JOIN policy_documents d ON d.doc_id = c.doc_id
WHERE policy_chunks_fts MATCH ?1
  AND d.audience_rank <= ?2
  AND v.effective_from <= ?3 AND (v.effective_to IS NULL OR v.effective_to > ?3)
  AND (?4 IS NULL OR d.category = ?4)
ORDER BY score LIMIT ?5`;

type Row = {
  chunk_id: string;
  doc_id: string;
  version: number;
  title: string;
  section: string;
  text: string;
  effective_from: string;
  effective_to: string | null;
  r2_key: string;
  score: number;
};

export class D1Fts5Retriever implements PolicyRetriever {
  readonly kind = "d1-fts" as const;
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  async search(req: RetrievalRequest): Promise<RetrievedPassage[]> {
    const match = toFtsQuery(req.query);
    if (match === null) return [];
    let rows: Row[];
    try {
      ({ results: rows } = await this.db
        .prepare(SQL)
        .bind(match, req.clearance, req.asOf, req.category ?? null, req.topK)
        .all<Row>());
    } catch (err) {
      throw new RetrievalError("D1 FTS query failed", { cause: err });
    }
    return rows.map((r) => ({
      passageId: r.chunk_id,
      docId: r.doc_id,
      version: r.version,
      title: r.title,
      section: r.section,
      text: r.text,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      sourceKey: r.r2_key,
      // bm25() is lower-is-better; negate so every retriever reports higher-is-better.
      score: -r.score,
    }));
  }
}
