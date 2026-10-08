// PolicyVersion -> markdown with front matter. Deterministic: prose varies per document through a
// named sub-stream, never per run. Six `##` sections; facts live in Policy, distractor numbers (form
// numbers, review cadence) in Policy and Procedure.
import type { Audience } from "../domain.ts";
import type { PolicyDoc, PolicyVersion } from "./corpus.ts";
import { rng } from "./prng.ts";

export const SECTION_NAMES = ["Purpose", "Scope", "Policy", "Procedure", "Exceptions", "Contacts"] as const;

const AUDIENCE_PHRASE: Record<Audience, string> = {
  all: "all employees",
  managers: "people managers",
  hr: "HR administrators",
};

const PURPOSE: ReadonlyArray<(title: string, who: string) => string> = [
  (t, w) => `This document is the ${t} policy. It explains what ${w} can expect and what they must do.`,
  (t, w) => `The ${t} policy sets the standard rules that ${w} follow, so decisions are consistent across teams.`,
  (t, w) => `This policy describes how ${t} works for ${w} and who to ask when something is unclear.`,
];

const PROCEDURE_EXTRA: readonly string[] = [
  "Keep a copy of every approval with the request.",
  "Your manager is notified automatically when a request is filed.",
  "Requests filed late are reviewed case by case.",
];

export function audiencePhrase(audience: Audience): string {
  return AUDIENCE_PHRASE[audience];
}

/** The `##` sections of a version, in order, without headings. */
export function versionSections(doc: PolicyDoc, version: PolicyVersion): Array<{ section: string; text: string }> {
  const r = rng(`corpus/${doc.docId}/prose`);
  const who = AUDIENCE_PHRASE[doc.audience];
  const purpose = (r.pick(PURPOSE) as (t: string, w: string) => string)(doc.title, who);
  const extra = r.pick(PROCEDURE_EXTRA);
  const policyLines = version.facts.map((f) => `- ${f.sentence}`);
  if (doc.distractors.reviewMonths !== null) {
    policyLines.push(`- Policy owners review this section every ${doc.distractors.reviewMonths} months.`);
  }
  return [
    { section: "Purpose", text: purpose },
    {
      section: "Scope",
      text: `This policy applies to ${who} in every region where the company operates. Where local law sets a stricter standard, the stricter standard applies.`,
    },
    { section: "Policy", text: policyLines.join("\n") },
    {
      section: "Procedure",
      text: [`- File requests through the HR portal using Form PD-${doc.distractors.formNumber}.`, `- ${extra}`].join("\n"),
    },
    {
      section: "Exceptions",
      text: `Exceptions require written approval from the ${doc.ownerTeam} team and are recorded with the request.`,
    },
    {
      section: "Contacts",
      text: `Questions about this policy go to the ${doc.ownerTeam} team. Open a support request for anything that needs follow-up.`,
    },
  ];
}

export function renderVersionMarkdown(doc: PolicyDoc, version: PolicyVersion): string {
  const lines = [
    "---",
    `doc_id: ${doc.docId}`,
    `version: ${version.version}`,
    `title: ${doc.title}`,
    `category: ${doc.category}`,
    `audience: ${doc.audience}`,
    `effective_from: ${version.effectiveFrom}`,
    `effective_to: ${version.effectiveTo ?? "null"}`,
    `supersedes: ${version.version > 1 ? version.version - 1 : "null"}`,
    `change_summary: ${version.changeSummary}`,
    "---",
    `# ${doc.title}`,
    `Effective from ${version.effectiveFrom}. Applies to: ${AUDIENCE_PHRASE[doc.audience]}.`,
  ];
  for (const s of versionSections(doc, version)) lines.push(`## ${s.section}`, s.text);
  return `${lines.join("\n")}\n`;
}
