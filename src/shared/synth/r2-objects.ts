// R2 objects for the 155 policy versions: key plus the five custom metadata fields AI Search can
// filter on (at most 5 per instance). Shared by local seeding, remote seeding and the test setup.
import type { Manifest } from "./dataset.ts";
import { toUnixSeconds } from "./dates.ts";

/** effective_to_ts for open-ended versions: 2100-01-01T00:00:00Z. */
export const OPEN_ENDED_TS = 4102444800;

export type R2PolicyObject = {
  key: string;
  customMetadata: {
    doc_id: string;
    version: string;
    audience_rank: string;
    effective_from_ts: string;
    effective_to_ts: string;
  };
};

export function r2PolicyObjects(manifest: Manifest): R2PolicyObject[] {
  return manifest.documents.flatMap((d) =>
    d.versions.map((v) => ({
      key: v.r2Key,
      customMetadata: {
        doc_id: d.docId,
        version: String(v.version),
        audience_rank: String(d.rank),
        effective_from_ts: String(toUnixSeconds(v.effectiveFrom)),
        effective_to_ts: String(v.effectiveTo ? toUnixSeconds(v.effectiveTo) : OPEN_ENDED_TS),
      },
    })),
  );
}
