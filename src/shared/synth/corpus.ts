// Versioned policy corpus: 100 documents, 155 versions. Version dates are whole-month offsets from
// M0 = firstOfMonth(AS_OF), placed backward from the version that must be current, so the current,
// superseded and scheduled structure is fixed by construction for any AS_OF.
import type { Audience, Clearance, PolicyCategory, VersionStatus } from "../domain.ts";
import { AUDIENCE_RANK, policyR2Key } from "../domain.ts";
import { versionStatusAt } from "../dates.ts";
import type { ArchetypeKey } from "./archetypes.ts";
import { ARCHETYPES, capitalize } from "./archetypes.ts";
import { BLUEPRINTS, OWNER_TEAMS, docIdFor } from "./blueprints.ts";
import { addMonths, firstOfMonth } from "./dates.ts";
import { rng } from "./prng.ts";
import type { Rng } from "./prng.ts";

export type Fact = {
  /** Stable across versions, e.g. "POL-014.f2". */
  factId: string;
  archetype: ArchetypeKey;
  subject: string;
  value: number;
  /** Value as it appears in prose, e.g. "$1,500" or "1.5". */
  display: string;
  /** Canonical numeric string used by the scorer and the leak check, e.g. "1500" or "1.5". */
  normalized: string;
  sentence: string;
};

export type Distractors = { formNumber: number; reviewMonths: number | null };

export type PolicyVersion = {
  docId: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: VersionStatus;
  r2Key: string;
  changeSummary: string;
  /** Fact ids whose value differs from the previous version. */
  changedFactIds: string[];
  facts: Fact[];
};

export type PolicyDoc = {
  docId: string;
  title: string;
  category: PolicyCategory;
  audience: Audience;
  rank: Clearance;
  ownerTeam: string;
  structure: VersionStructure;
  distractors: Distractors;
  versions: PolicyVersion[];
};

export type VersionStructure = "1v" | "2v" | "2v-scheduled" | "3v" | "3v-scheduled";

export type Corpus = { asOf: string; m0: string; docs: PolicyDoc[] };

/** Canonical numeric string: "1.50" -> "1.5", 1500 -> "1500". */
export function canonicalNumber(value: number): string {
  return String(Number(value.toFixed(6)));
}

function assignStructures(): Map<string, VersionStructure> {
  const r = rng("corpus/structure");
  const docIds = BLUEPRINTS.map((_, i) => docIdFor(i));
  const allDocs = r.shuffle(docIds.filter((_, i) => BLUEPRINTS[i]?.audience === "all"));
  const structures = new Map<string, VersionStructure>();
  // Scheduled versions live in `all` documents, so every persona can be asked about them, and at
  // least 25 `all` documents have superseded versions for the outdated-document eval cases.
  const take = (n: number, s: VersionStructure) => {
    for (const id of allDocs.splice(0, n)) structures.set(id, s);
  };
  take(6, "2v-scheduled");
  take(2, "3v-scheduled");
  take(20, "2v");
  take(5, "3v");
  const rest = r.shuffle(docIds.filter((id) => !structures.has(id)));
  const pool: VersionStructure[] = [
    ...Array<VersionStructure>(9).fill("2v"),
    ...Array<VersionStructure>(3).fill("3v"),
    ...Array<VersionStructure>(55).fill("1v"),
  ];
  if (pool.length !== rest.length) throw new Error(`structure pool ${pool.length} != ${rest.length}`);
  rest.forEach((id, i) => structures.set(id, pool[i] as VersionStructure));
  return structures;
}

const VERSION_COUNT: Record<VersionStructure, number> = { "1v": 1, "2v": 2, "2v-scheduled": 2, "3v": 3, "3v-scheduled": 3 };

/** Effective dates for each version, as [from, to) pairs, oldest first. */
function versionDates(structure: VersionStructure, m0: string, r: Rng): Array<{ from: string; to: string | null }> {
  const a = r.int(0, 12);
  const current = addMonths(m0, -a);
  const scheduled = structure.endsWith("scheduled") ? addMonths(m0, r.int(3, 9)) : null;
  const n = VERSION_COUNT[structure];
  const currentIndex = scheduled ? n - 2 : n - 1;
  const froms: string[] = new Array<string>(n);
  froms[currentIndex] = current;
  for (let i = currentIndex - 1; i >= 0; i--) froms[i] = addMonths(froms[i + 1] as string, -r.int(6, 18));
  if (scheduled) froms[n - 1] = scheduled;
  return froms.map((from, i) => ({ from, to: i + 1 < n ? (froms[i + 1] as string) : null }));
}

export type ValueGuard = (rank: Clearance, normalized: string) => boolean;

/**
 * Draws a value from the archetype band for `rank`. `accept` rejects values (restricted-value
 * disjointness, distinctness inside a document); the draw is retried up to 50 times on the fact's
 * own sub-stream and throws if no acceptable value is found.
 */
function drawValue(
  archetype: ArchetypeKey,
  rank: Clearance,
  r: Rng,
  accept: (normalized: string) => boolean,
  label: string,
): number {
  const band = ARCHETYPES[archetype].bands[rank];
  for (let attempt = 0; attempt < 50; attempt++) {
    const v = r.pick(band);
    if (accept(canonicalNumber(v))) return v;
  }
  throw new Error(`could not draw an acceptable ${archetype} value for ${label} (rank ${rank})`);
}

function makeFact(factId: string, archetype: ArchetypeKey, subject: string, value: number): Fact {
  const a = ARCHETYPES[archetype];
  return {
    factId,
    archetype,
    subject,
    value,
    display: a.format(value),
    normalized: canonicalNumber(value),
    sentence: a.sentence(subject, value),
  };
}

export type CorpusOptions = {
  /**
   * Called once per rank, before that rank's facts are drawn, with every document of a lower rank
   * already complete. Returns the normalized numeric tokens a value of this rank must avoid.
   */
  forbiddenTokens?: (rank: Clearance, lowerRankDocs: PolicyDoc[]) => ReadonlySet<string>;
};

export function generateCorpus(asOf: string, options: CorpusOptions = {}): Corpus {
  const m0 = firstOfMonth(asOf);
  const structures = assignStructures();
  const docs: PolicyDoc[] = BLUEPRINTS.map((bp, i) => {
    const docId = docIdFor(i);
    const structure = structures.get(docId) as VersionStructure;
    const dates = versionDates(structure, m0, rng(`corpus/${docId}/dates`));
    const dr = rng(`corpus/${docId}/distractors`);
    const rank = AUDIENCE_RANK[bp.audience];
    return {
      docId,
      title: bp.title,
      category: bp.category,
      audience: bp.audience,
      rank,
      ownerTeam: OWNER_TEAMS[bp.category],
      structure,
      distractors: { formNumber: dr.int(400, 499), reviewMonths: dr.chance(0.5) ? dr.pick([6, 12, 18, 24]) : null },
      versions: dates.map((d, v) => ({
        docId,
        version: v + 1,
        effectiveFrom: d.from,
        effectiveTo: d.to,
        status: versionStatusAt({ effectiveFrom: d.from, effectiveTo: d.to }, asOf),
        r2Key: policyR2Key(docId, bp.audience, v + 1),
        changeSummary: "",
        changedFactIds: [],
        facts: [],
      })),
    };
  });

  // Documents are completed in rank order: all rank 1 documents (every version), then rank 2, then
  // rank 3, so a restricted value can be checked against everything a lower clearance can read.
  for (const rank of [1, 2, 3] as const) {
    const lower = docs.filter((d) => d.rank < rank);
    const forbidden = options.forbiddenTokens?.(rank, lower) ?? new Set<string>();
    for (const doc of docs.filter((d) => d.rank === rank)) fillFacts(doc, forbidden);
  }
  return { asOf, m0, docs };
}

function fillFacts(doc: PolicyDoc, forbidden: ReadonlySet<string>): void {
  const bp = BLUEPRINTS[Number(doc.docId.slice(4)) - 1];
  if (!bp) throw new Error(`no blueprint for ${doc.docId}`);
  const factStreams = bp.facts.map((_, i) => rng(`corpus/${doc.docId}/fact${i + 1}`));
  const okFor = (others: string[]) => (n: string) => !forbidden.has(n) && !others.includes(n);

  // Version 1: every fact gets a value, distinct within the document version.
  let previous: Fact[] = [];
  bp.facts.forEach(([archetype, subject], i) => {
    const value = drawValue(
      archetype,
      doc.rank,
      factStreams[i] as Rng,
      okFor(previous.map((f) => f.normalized)),
      `${doc.docId}.f${i + 1}`,
    );
    previous.push(makeFact(`${doc.docId}.f${i + 1}`, archetype, subject, value));
  });
  const v1 = doc.versions[0] as PolicyVersion;
  v1.facts = previous;
  v1.changeSummary = "Initial version.";

  // Successors change 1 or 2 facts within the same band.
  for (const version of doc.versions.slice(1)) {
    const cr = rng(`corpus/${doc.docId}/v${version.version}/changes`);
    const changeCount = Math.min(previous.length, cr.int(1, 2));
    const toChange = new Set(cr.shuffle(previous.map((_, i) => i)).slice(0, changeCount));
    const next: Fact[] = previous.map((f) => ({ ...f }));
    const summaries: string[] = [];
    for (const i of [...toChange].sort((a, b) => a - b)) {
      const old = next[i] as Fact;
      const taken = next.map((f) => f.normalized);
      const value = drawValue(old.archetype, doc.rank, factStreams[i] as Rng, okFor(taken), `${old.factId}@v${version.version}`);
      next[i] = makeFact(old.factId, old.archetype, old.subject, value);
      const a = ARCHETYPES[old.archetype];
      summaries.push(
        `${capitalize(a.changeLabel(old.subject))} changed from ${a.formatWithUnit(old.value)} to ${a.formatWithUnit(value)}.`,
      );
      version.changedFactIds.push(old.factId);
    }
    version.facts = next;
    version.changeSummary = summaries.join(" ");
    previous = next;
  }
}

export function currentVersion(doc: PolicyDoc): PolicyVersion {
  const v = doc.versions.find((x) => x.status === "current");
  if (!v) throw new Error(`${doc.docId} has no current version`);
  return v;
}
