// Nine fact archetypes. Facts are generated from these, not hand-written per document: each archetype
// has a unit, a sentence template, 3 question templates, a stale-value question template, a change
// summary label, and three value bands, one per audience rank. Restricted bands (rank 2, rank 3) sit
// above the rank 1 band, and the generator additionally enforces that a restricted value's normalized
// forms never appear in any lower-rank document (corpus.ts).
import type { Clearance } from "../domain.ts";

export const ARCHETYPE_KEYS = [
  "money_cap",
  "money_threshold",
  "days_deadline",
  "days_waiting",
  "accrual_rate",
  "percent",
  "count_per_year",
  "hours",
  "notice_weeks",
] as const;
export type ArchetypeKey = (typeof ARCHETYPE_KEYS)[number];

export type Archetype = {
  key: ArchetypeKey;
  unit: "usd" | "days" | "days_per_month" | "percent" | "times_per_year" | "hours" | "weeks";
  /** The fact sentence as it appears in the Policy section. */
  sentence(subject: string, value: number): string;
  /** Question templates; `{subject}` and `{title}` are substituted. */
  questions: readonly [string, string, string];
  /** Asks whether a superseded value still holds; `{stale}` is the formatted stale value. */
  staleQuestion: string;
  /** Change-summary phrase: "<label> changed from <old> to <new>." */
  changeLabel(subject: string): string;
  /** Value bands per audience rank: candidate values in ascending order. */
  bands: Readonly<Record<Clearance, readonly number[]>>;
  /** Formats a value as it appears in prose (without the unit noun). */
  format(value: number): string;
  /** Formats a value with its unit, for change summaries. */
  formatWithUnit(value: number): string;
};

function range(from: number, to: number, step = 1): number[] {
  const out: number[] = [];
  // Integer arithmetic on scaled values avoids float drift (0.25 steps, 0.5 steps).
  const scale = 1000;
  for (let v = Math.round(from * scale); v <= Math.round(to * scale); v += Math.round(step * scale)) out.push(v / scale);
  return out;
}

export function capitalize(s: string): string {
  return s.length === 0 ? s : (s[0] as string).toUpperCase() + s.slice(1);
}

export function formatUsd(value: number): string {
  return `$${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const int = (v: number) => String(v);
const decimal = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

const MONEY_BANDS = { 1: range(25, 1975, 25), 2: range(2050, 4950, 100), 3: range(5075, 9975, 100) } as const;
const DAY_BANDS = { 1: range(3, 60), 2: range(61, 120), 3: range(121, 180) } as const;

export const ARCHETYPES: Readonly<Record<ArchetypeKey, Archetype>> = {
  money_cap: {
    key: "money_cap",
    unit: "usd",
    sentence: (s, v) => `The maximum ${s} is ${formatUsd(v)}.`,
    questions: ["What is the maximum {subject}?", "How much is the maximum {subject}?", "What's the cap on the {subject}?"],
    staleQuestion: "Is the maximum {subject} still {stale}?",
    changeLabel: (s) => `Maximum ${s}`,
    bands: MONEY_BANDS,
    format: formatUsd,
    formatWithUnit: formatUsd,
  },
  money_threshold: {
    key: "money_threshold",
    unit: "usd",
    sentence: (s, v) => `${capitalize(s)} above ${formatUsd(v)} require written pre-approval.`,
    questions: [
      "Above what amount do {subject} require written pre-approval?",
      "What is the pre-approval threshold for {subject}?",
      "How much can {subject} cost before written pre-approval is needed?",
    ],
    staleQuestion: "Do {subject} above {stale} still require written pre-approval?",
    changeLabel: (s) => `Pre-approval threshold for ${s}`,
    bands: MONEY_BANDS,
    format: formatUsd,
    formatWithUnit: formatUsd,
  },
  days_deadline: {
    key: "days_deadline",
    unit: "days",
    sentence: (s, v) => `${capitalize(s)} must be completed within ${v} calendar ${plural(v, "day", "days")}.`,
    questions: [
      "How many calendar days are allowed for {subject}?",
      "What is the deadline for {subject}?",
      "Within how many days must {subject} be completed?",
    ],
    staleQuestion: "Is the deadline for {subject} still {stale} days?",
    changeLabel: (s) => `Deadline for ${s}`,
    bands: DAY_BANDS,
    format: int,
    formatWithUnit: (v) => `${v} calendar ${plural(v, "day", "days")}`,
  },
  days_waiting: {
    key: "days_waiting",
    unit: "days",
    sentence: (s, v) => `${capitalize(s)} begins after a waiting period of ${v} ${plural(v, "day", "days")}.`,
    questions: [
      "How long is the waiting period before {subject} begins?",
      "How many days is the waiting period for {subject}?",
      "How many days does a new employee wait for {subject}?",
    ],
    staleQuestion: "Is the waiting period for {subject} still {stale} days?",
    changeLabel: (s) => `Waiting period for ${s}`,
    bands: DAY_BANDS,
    format: int,
    formatWithUnit: (v) => `${v} ${plural(v, "day", "days")}`,
  },
  accrual_rate: {
    key: "accrual_rate",
    unit: "days_per_month",
    sentence: (s, v) => `${capitalize(s)} accrues at ${decimal(v)} days per month.`,
    questions: [
      "How many days per month does {subject} accrue?",
      "What is the monthly accrual rate for {subject}?",
      "How fast does {subject} accrue?",
    ],
    staleQuestion: "Does {subject} still accrue at {stale} days per month?",
    changeLabel: (s) => `Monthly accrual for ${s}`,
    bands: { 1: range(1, 2, 0.25), 2: range(2.125, 2.875, 0.25), 3: range(3.125, 3.875, 0.25) },
    format: decimal,
    formatWithUnit: (v) => `${decimal(v)} days per month`,
  },
  percent: {
    key: "percent",
    unit: "percent",
    sentence: (s, v) => `${capitalize(s)} is ${v}% of eligible pay.`,
    questions: [
      "What percentage of eligible pay is {subject}?",
      "How much is {subject} as a percentage of pay?",
      "What is the rate for {subject}?",
    ],
    staleQuestion: "Is {subject} still {stale}% of eligible pay?",
    changeLabel: (s) => `Rate for ${s}`,
    bands: { 1: range(1, 25, 0.5), 2: range(26, 49), 3: range(51, 74) },
    format: (v) => String(v),
    formatWithUnit: (v) => `${v}%`,
  },
  count_per_year: {
    key: "count_per_year",
    unit: "times_per_year",
    sentence: (s, v) => `${capitalize(s)} is limited to ${v} ${plural(v, "time", "times")} per calendar year.`,
    questions: [
      "How many times per calendar year is {subject} allowed?",
      "What is the yearly limit on {subject}?",
      "How often per calendar year can {subject} happen?",
    ],
    staleQuestion: "Is {subject} still limited to {stale} times per year?",
    changeLabel: (s) => `Yearly limit on ${s}`,
    bands: { 1: range(1, 12), 2: range(13, 24), 3: range(25, 36) },
    format: int,
    formatWithUnit: (v) => `${v} ${plural(v, "time", "times")}`,
  },
  hours: {
    key: "hours",
    unit: "hours",
    sentence: (s, v) => `${capitalize(s)} requires ${v} ${plural(v, "hour", "hours")}.`,
    questions: [
      "How many hours does {subject} require?",
      "What is the hour requirement for {subject}?",
      "How long, in hours, is {subject}?",
    ],
    staleQuestion: "Does {subject} still require {stale} hours?",
    changeLabel: (s) => `Hour requirement for ${s}`,
    bands: { 1: range(1, 40), 2: range(41, 80), 3: range(81, 120) },
    format: int,
    formatWithUnit: (v) => `${v} ${plural(v, "hour", "hours")}`,
  },
  notice_weeks: {
    key: "notice_weeks",
    unit: "weeks",
    sentence: (s, v) => `${capitalize(s)} requires ${v} ${plural(v, "week", "weeks")} of notice.`,
    questions: [
      "How much notice does {subject} require?",
      "How many weeks of notice are needed for {subject}?",
      "What is the notice period for {subject}?",
    ],
    staleQuestion: "Is the notice period for {subject} still {stale} weeks?",
    changeLabel: (s) => `Notice period for ${s}`,
    bands: { 1: range(1, 12), 2: range(13, 20), 3: range(21, 30) },
    format: int,
    formatWithUnit: (v) => `${v} ${plural(v, "week", "weeks")}`,
  },
};

/** Fills a question template. */
export function fillTemplate(template: string, vars: { subject: string; title?: string; stale?: string }): string {
  return template
    .replace("{subject}", vars.subject)
    .replace("{title}", vars.title ?? "")
    .replace("{stale}", vars.stale ?? "");
}
