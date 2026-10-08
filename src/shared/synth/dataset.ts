// Builds the complete generated dataset for one business date: the manifest (documents, versions,
// facts, chunks with their text, hashes, validity window), the org, the markdown files and the seed
// statements. scripts/generate.ts writes it to disk; tests build it in memory.
import { canonicalJson } from "../canonical-json.ts";
import type { Audience, Clearance, PolicyCategory, VersionStatus } from "../domain.ts";
import { sha256Hex } from "../sha256.ts";
import { chunkMarkdown } from "./chunk.ts";
import { DEFAULT_AS_OF } from "./counts.ts";
import type { Distractors, Fact, VersionStructure } from "./corpus.ts";
import { generateCorpus } from "./corpus.ts";
import { addDays, isValidDate, minDate } from "./dates.ts";
import type { Org } from "./org.ts";
import { generateOrg } from "./org.ts";
import { GENERATOR_SEED } from "./prng.ts";
import { renderVersionMarkdown } from "./render-markdown.ts";

export type ManifestChunk = { chunkId: string; ordinal: number; section: string; text: string };

export type ManifestVersion = {
  version: number;
  r2Key: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: VersionStatus;
  changeSummary: string;
  changedFactIds: string[];
  contentSha256: string;
  facts: Fact[];
  chunks: ManifestChunk[];
};

export type ManifestDocument = {
  docId: string;
  title: string;
  category: PolicyCategory;
  audience: Audience;
  rank: Clearance;
  ownerTeam: string;
  structure: VersionStructure;
  distractors: Distractors;
  versions: ManifestVersion[];
};

export type Manifest = {
  generator: string;
  seed: string;
  asOf: string;
  /** The eval runner grades only a server whose business date is in [validFrom, validUntil). */
  validFrom: string;
  validUntil: string;
  counts: { documents: number; versions: number; current: number; superseded: number; scheduled: number; facts: number; chunks: number };
  documents: ManifestDocument[];
  /** SHA-256 over the canonical JSON of the manifest (without this field) and the org. */
  datasetSha256: string;
};

export type GeneratedFile = { path: string; content: string };

export type Dataset = { manifest: Manifest; org: Org; markdownFiles: GeneratedFile[] };

export function generateDataset(asOf: string = DEFAULT_AS_OF): Dataset {
  if (!isValidDate(asOf)) throw new Error(`--as-of must be a valid YYYY-MM-DD date, got ${asOf}`);
  const corpus = generateCorpus(asOf);
  const org = generateOrg(asOf);
  const markdownFiles: GeneratedFile[] = [];
  const documents: ManifestDocument[] = corpus.docs.map((d) => ({
    docId: d.docId,
    title: d.title,
    category: d.category,
    audience: d.audience,
    rank: d.rank,
    ownerTeam: d.ownerTeam,
    structure: d.structure,
    distractors: d.distractors,
    versions: d.versions.map((v) => {
      const markdown = renderVersionMarkdown(d, v);
      markdownFiles.push({ path: v.r2Key, content: markdown });
      return {
        version: v.version,
        r2Key: v.r2Key,
        effectiveFrom: v.effectiveFrom,
        effectiveTo: v.effectiveTo,
        status: v.status,
        changeSummary: v.changeSummary,
        changedFactIds: v.changedFactIds,
        contentSha256: sha256Hex(markdown),
        facts: v.facts,
        chunks: chunkMarkdown(markdown, { docId: d.docId, version: v.version, title: d.title }).map((c) => ({
          chunkId: c.chunkId,
          ordinal: c.ordinal,
          section: c.section,
          text: c.text,
        })),
      };
    }),
  }));
  const versions = documents.flatMap((d) => d.versions);
  const scheduledStarts = versions.filter((v) => v.status === "scheduled").map((v) => v.effectiveFrom);
  const firstSession = org.sessions.map((s) => s.startsAt.slice(0, 10)).sort()[0] ?? addDays(asOf, 14);
  const validUntil = scheduledStarts.reduce(minDate, firstSession);
  const body: Omit<Manifest, "datasetSha256"> = {
    generator: "peopledesk-synth-v1",
    seed: GENERATOR_SEED,
    asOf,
    validFrom: asOf,
    validUntil,
    counts: {
      documents: documents.length,
      versions: versions.length,
      current: versions.filter((v) => v.status === "current").length,
      superseded: versions.filter((v) => v.status === "superseded").length,
      scheduled: versions.filter((v) => v.status === "scheduled").length,
      facts: versions.reduce((n, v) => n + v.facts.length, 0),
      chunks: versions.reduce((n, v) => n + v.chunks.length, 0),
    },
    documents,
  };
  const datasetSha256 = sha256Hex(canonicalJson({ manifest: body, org }));
  return { manifest: { ...body, datasetSha256 }, org, markdownFiles };
}

/** Pretty JSON with a trailing newline (LF only). */
export function toJsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
