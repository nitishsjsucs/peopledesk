import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractNumbers } from "../../evals/lib/normalize.ts";
import { ROLE_CLEARANCE } from "../../src/shared/domain.ts";
import type { PersonaKey } from "../../src/shared/domain.ts";
import { EXPECTED_COUNTS } from "../../src/shared/synth/counts.ts";
import { generateDataset } from "../../src/shared/synth/dataset.ts";
import { directorySliceOf, generateEvalCases, toJsonl } from "../../src/shared/synth/eval-cases.ts";
import type { EvalCase } from "../../src/shared/synth/eval-cases.ts";

const repo = resolve(import.meta.dirname, "../..");
const { manifest, org, markdownFiles } = generateDataset("2026-10-01");
const cases = generateEvalCases(manifest, org);
const committed = readFileSync(join(repo, "evals/dataset/asof-2026-10-01/cases.jsonl"), "utf8");
const meta = JSON.parse(readFileSync(join(repo, "evals/dataset/asof-2026-10-01/meta.json"), "utf8")) as { datasetSha256: string };

const persona = (key: PersonaKey) => org.personas.find((p) => p.key === key)!;
const docById = new Map(manifest.documents.map((d) => [d.docId, d]));
const markdownByKey = new Map(markdownFiles.map((f) => [f.path, f.content]));
const clearanceOf = (key: PersonaKey) => ROLE_CLEARANCE[persona(key).role];
const count = (pred: (c: EvalCase) => boolean) => cases.filter(pred).length;
const sub = (s: string) => (c: EvalCase) => c.meta.subcategory === s;

describe("eval dataset", () => {
  it("has exactly 200 cases with the 70/25/20/30/55 split and unique ids", () => {
    expect(cases).toHaveLength(EXPECTED_COUNTS.evalCases);
    for (const [category, n] of Object.entries(EXPECTED_COUNTS.evalByCategory)) expect(count((c) => c.category === category), category).toBe(n);
    expect(new Set(cases.map((c) => c.id)).size).toBe(200);
  });

  it("matches the committed cases.jsonl and the dataset hash", () => {
    expect(committed).toBe(toJsonl(cases));
    expect(meta.datasetSha256).toBe(manifest.datasetSha256);
  });

  it("has the documented sub-splits", () => {
    const answerable = cases.filter((c) => c.category === "policy_answerable");
    expect(answerable.filter((c) => ["tenured_employee", "new_hire_unbooked", "new_hire_booked"].includes(c.persona) && c.meta.subcategory === "rank1")).toHaveLength(50);
    expect(answerable.filter((c) => c.persona === "manager_with_new_hires" && c.meta.subcategory === "rank2")).toHaveLength(12);
    expect(answerable.filter((c) => c.persona === "hr_admin" && c.meta.subcategory === "rank3")).toHaveLength(8);
    expect(count(sub("stale_value"))).toBe(17);
    expect(count(sub("future_version"))).toBe(8);
    expect(count((c) => c.category === "ambiguous" && c.meta.subcategory.startsWith("policy:"))).toBe(12);
    expect(new Set(cases.filter((c) => c.meta.subcategory.startsWith("policy:")).map((c) => c.meta.subcategory)).size).toBe(6);
    expect(count(sub("ticket_without_problem"))).toBe(4);
    expect(count(sub("booking_without_session"))).toBe(4);
    const retrieval = cases.filter(sub("retrieval"));
    expect(retrieval.filter((c) => clearanceOf(c.persona) === 1)).toHaveLength(10);
    expect(retrieval.filter((c) => clearanceOf(c.persona) === 2)).toHaveLength(5);
    expect(count(sub("onboarding_non_report_by_name"))).toBe(3);
    expect(count(sub("onboarding_by_explicit_id"))).toBe(2);
    expect(count(sub("schedule_out_of_scope"))).toBe(5);
    expect(count(sub("others_tickets"))).toBe(5);
    expect(count(sub("create_support_ticket"))).toBe(15);
    expect(count(sub("list_my_tickets"))).toBe(10);
    expect(count(sub("onboarding_self"))).toBe(5);
    expect(count(sub("onboarding_report"))).toBe(5);
    expect(count(sub("list_orientation_sessions"))).toBe(10);
    expect(count(sub("schedule_self"))).toBe(6);
    expect(count(sub("schedule_report"))).toBe(4);
  });

  it("references only existing personas, documents, versions, employees and sessions", () => {
    const employees = new Set(org.employees.map((e) => e.id));
    const sessions = new Set(org.sessions.map((s) => s.id));
    for (const c of cases) {
      expect(org.personas.some((p) => p.key === c.persona), c.id).toBe(true);
      const e = c.expected;
      if (e.type === "answer") {
        for (const ref of [...e.mustCiteAnyOf, ...e.mustNotCite]) {
          expect(docById.get(ref.docId)?.versions.some((v) => ref.version === undefined || v.version === ref.version), c.id).toBe(true);
        }
      }
      if (e.type === "refuse") {
        for (const d of e.restrictedDocIds) expect(docById.has(d), c.id).toBe(true);
        if (e.forbiddenTargetId) expect(employees.has(e.forbiddenTargetId), c.id).toBe(true);
      }
      if (c.meta.namedPerson) expect(employees.has(c.meta.namedPerson.employeeId), c.id).toBe(true);
      if (c.meta.sessionId) expect(sessions.has(c.meta.sessionId), c.id).toBe(true);
    }
  });

  it("asks answerable and outdated questions about current versions the persona can read", () => {
    for (const c of cases.filter((x) => x.expected.type === "answer")) {
      const e = c.expected as Extract<EvalCase["expected"], { type: "answer" }>;
      for (const ref of e.mustCiteAnyOf) {
        const d = docById.get(ref.docId)!;
        expect(d.versions.find((v) => v.version === ref.version)?.status, c.id).toBe("current");
        expect(d.rank, c.id).toBeLessThanOrEqual(clearanceOf(c.persona));
        const v = d.versions.find((x) => x.version === ref.version)!;
        expect(v.facts.some((f) => e.mustContainAll.includes(f.normalized)), c.id).toBe(true);
      }
      for (const ref of e.mustNotCite) expect(docById.get(ref.docId)?.versions.find((v) => v.version === ref.version)?.status, c.id).not.toBe("current");
    }
  });

  it("phrases stale questions with a superseded value that differs from today's", () => {
    for (const c of cases.filter(sub("stale_value"))) {
      const e = c.expected as Extract<EvalCase["expected"], { type: "answer" }>;
      const asked = extractNumbers(c.question);
      expect(asked.length, c.id).toBeGreaterThan(0);
      expect(asked.some((n) => e.mustContainAll.includes(n)), c.id).toBe(false);
    }
    for (const c of cases.filter(sub("future_version"))) {
      const e = c.expected as Extract<EvalCase["expected"], { type: "answer" }>;
      const d = docById.get(e.mustCiteAnyOf[0]!.docId)!;
      const scheduled = d.versions.find((v) => v.status === "scheduled")!;
      expect(e.mustNotCite.some((r) => r.version === scheduled.version), c.id).toBe(true);
      expect(scheduled.changedFactIds, c.id).toContain(c.meta.factId);
    }
  });

  it("keeps every restricted number in its restricted document and out of everything the persona may read", () => {
    for (const c of cases.filter((x) => x.expected.type === "refuse" && x.expected.restrictedNumbers.length > 0)) {
      const e = c.expected as Extract<EvalCase["expected"], { type: "refuse" }>;
      const restricted = docById.get(e.restrictedDocIds[0]!)!;
      expect(restricted.rank, c.id).toBeGreaterThan(clearanceOf(c.persona));
      const inRestricted = new Set(restricted.versions.flatMap((v) => extractNumbers(markdownByKey.get(v.r2Key)!)));
      const readable = new Set(
        manifest.documents
          .filter((d) => d.rank <= clearanceOf(c.persona))
          .flatMap((d) => d.versions.flatMap((v) => extractNumbers(markdownByKey.get(v.r2Key)!))),
      );
      for (const n of e.restrictedNumbers) {
        expect(inRestricted.has(n), `${c.id} ${n}`).toBe(true);
        expect(readable.has(n), `${c.id} ${n}`).toBe(false);
      }
    }
  });

  it("names only in-slice people in allowed cases and only out-of-slice people in unauthorized cases", () => {
    for (const c of cases.filter((x) => x.meta.namedPerson)) {
      const named = c.meta.namedPerson!;
      const inSlice = directorySliceOf(org, persona(c.persona).employeeId).some((e) => e.id === named.employeeId);
      expect(named.inPersonaSlice, c.id).toBe(inSlice);
      expect(inSlice, c.id).toBe(c.category !== "unauthorized");
      expect(c.question, c.id).toContain(named.fullName);
    }
    for (const c of cases.filter(sub("onboarding_by_explicit_id"))) {
      expect(c.question, c.id).toContain(c.meta.explicitId);
      expect(directorySliceOf(org, persona(c.persona).employeeId).some((e) => e.id === c.meta.explicitId), c.id).toBe(false);
    }
  });

  it("schedules only unbooked people in onboarding into future sessions with seats", () => {
    const planned = new Set(org.onboardingPlans.map((p) => p.employeeId));
    const booked = new Set(org.bookings.map((b) => b.employeeId));
    for (const c of cases.filter((x) => x.expected.type === "tool" && x.expected.tool === "schedule_orientation_session")) {
      const e = c.expected as Extract<EvalCase["expected"], { type: "tool" }>;
      const target = (e.argsSubset["employeeId"] as string | undefined) ?? persona(c.persona).employeeId;
      expect(planned.has(target), c.id).toBe(true);
      expect(booked.has(target), c.id).toBe(false);
      const s = org.sessions.find((x) => x.id === e.argsSubset["sessionId"])!;
      expect(s.startsAt.slice(0, 10) > manifest.asOf, c.id).toBe(true);
      expect(org.bookings.filter((b) => b.sessionId === s.id).length, c.id).toBeLessThan(s.capacity);
    }
  });

  it("makes every ambiguous candidate readable by the persona", () => {
    for (const c of cases.filter((x) => x.expected.type === "clarify")) {
      const e = c.expected as Extract<EvalCase["expected"], { type: "clarify" }>;
      for (const id of e.candidateDocIds ?? []) expect(docById.get(id)!.rank, c.id).toBeLessThanOrEqual(clearanceOf(c.persona));
    }
  });

  it("gives action cases verifiable expectations", () => {
    for (const c of cases.filter((x) => x.category === "action_request")) {
      expect(c.expected.type, c.id).toBe("tool");
    }
    for (const c of cases.filter(sub("list_my_tickets"))) {
      const e = c.expected as Extract<EvalCase["expected"], { type: "tool" }>;
      expect(e.resultCheck?.ids, c.id).toEqual(
        org.tickets.filter((t) => t.requesterId === persona(c.persona).employeeId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((t) => t.id),
      );
    }
  });
});
