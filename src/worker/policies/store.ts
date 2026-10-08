// PolicyStore: D1 metadata, R2 bodies and version history, always filtered by the caller's clearance.
// A document above the caller's clearance is indistinguishable from one that does not exist (404).
import type { PolicyDocument, PolicyListItem, PolicyVersionView, VersionMeta } from "../../shared/api-types.ts";
import type { Audience, Clearance, PolicyCategory } from "../../shared/domain.ts";
import { versionStatusAt } from "../../shared/dates.ts";

type DocRow = { doc_id: string; title: string; category: PolicyCategory; audience: Audience; audience_rank: Clearance };
type VersionRow = {
  version: number;
  effective_from: string;
  effective_to: string | null;
  change_summary: string;
  r2_key: string;
};

export class PolicyStore {
  private readonly db: D1Database;
  private readonly bucket: R2Bucket;
  constructor(db: D1Database, bucket: R2Bucket) {
    this.db = db;
    this.bucket = bucket;
  }

  /** Accessible documents with their version current at asOf. */
  async list(clearance: Clearance, asOf: string, filter: { category?: PolicyCategory; q?: string } = {}): Promise<PolicyListItem[]> {
    const q = filter.q?.trim() ? `%${filter.q.trim().toLowerCase()}%` : null;
    const { results } = await this.db
      .prepare(
        `SELECT d.doc_id, d.title, d.category, d.audience, v.version, v.effective_from
           FROM policy_documents d
           JOIN policy_versions v ON v.doc_id = d.doc_id
          WHERE d.audience_rank <= ?1
            AND v.effective_from <= ?2 AND (v.effective_to IS NULL OR v.effective_to > ?2)
            AND (?3 IS NULL OR d.category = ?3)
            AND (?4 IS NULL OR lower(d.title) LIKE ?4 OR lower(d.category) LIKE ?4)
          ORDER BY d.doc_id`,
      )
      .bind(clearance, asOf, filter.category ?? null, q)
      .all<{ doc_id: string; title: string; category: PolicyCategory; audience: Audience; version: number; effective_from: string }>();
    return results.map((r) => ({
      docId: r.doc_id,
      title: r.title,
      category: r.category,
      audience: r.audience,
      currentVersion: r.version,
      effectiveFrom: r.effective_from,
      updatedAt: r.effective_from,
    }));
  }

  private async doc(docId: string, clearance: Clearance): Promise<DocRow | null> {
    const row = await this.db
      .prepare("SELECT doc_id, title, category, audience, audience_rank FROM policy_documents WHERE doc_id = ?1")
      .bind(docId)
      .first<DocRow>();
    return row && row.audience_rank <= clearance ? row : null;
  }

  async getDocument(docId: string, clearance: Clearance, asOf: string): Promise<PolicyDocument | null> {
    const doc = await this.doc(docId, clearance);
    if (!doc) return null;
    const { results } = await this.db
      .prepare(
        "SELECT version, effective_from, effective_to, change_summary, r2_key FROM policy_versions WHERE doc_id = ?1 ORDER BY version",
      )
      .bind(docId)
      .all<VersionRow>();
    return {
      docId: doc.doc_id,
      title: doc.title,
      category: doc.category,
      audience: doc.audience,
      versions: results.map((v) => ({
        version: v.version,
        effectiveFrom: v.effective_from,
        effectiveTo: v.effective_to,
        status: versionStatusAt({ effectiveFrom: v.effective_from, effectiveTo: v.effective_to }, asOf),
        changeSummary: v.change_summary,
      })),
    };
  }

  async getVersion(docId: string, version: number, clearance: Clearance, asOf: string): Promise<PolicyVersionView | null> {
    const doc = await this.doc(docId, clearance);
    if (!doc) return null;
    const v = await this.db
      .prepare(
        "SELECT version, effective_from, effective_to, change_summary, r2_key FROM policy_versions WHERE doc_id = ?1 AND version = ?2",
      )
      .bind(docId, version)
      .first<VersionRow>();
    if (!v) return null;
    const object = await this.bucket.get(v.r2_key);
    if (!object) throw new Error(`R2 object missing for ${v.r2_key}`);
    const meta: VersionMeta = {
      docId: doc.doc_id,
      title: doc.title,
      category: doc.category,
      audience: doc.audience,
      version: v.version,
      effectiveFrom: v.effective_from,
      effectiveTo: v.effective_to,
      status: versionStatusAt({ effectiveFrom: v.effective_from, effectiveTo: v.effective_to }, asOf),
      changeSummary: v.change_summary,
    };
    return { meta, markdown: await object.text(), r2Key: v.r2_key };
  }
}
