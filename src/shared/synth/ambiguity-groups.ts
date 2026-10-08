// The only hand-written eval material: 6 ambiguity groups. Each names 2 or 3 `all` blueprints that
// share an archetype, plus two generic phrasings that do not say which document is meant. The
// expected outcome is a clarifying question, or an answer that covers at least two of the candidates.
import type { ArchetypeKey } from "./archetypes.ts";

export type AmbiguityGroup = {
  key: string;
  archetype: ArchetypeKey;
  titles: readonly string[];
  phrasings: readonly [string, string];
};

export const AMBIGUITY_GROUPS: readonly AmbiguityGroup[] = [
  {
    key: "leave_types",
    archetype: "accrual_rate",
    titles: ["PTO Accrual", "Sick Leave", "Mental Health Days"],
    phrasings: ["How many days off do I get?", "How much leave do I build up each month?"],
  },
  {
    key: "stipends",
    archetype: "money_cap",
    titles: ["Wellness Stipend", "Home Office Stipend", "Internet Reimbursement"],
    phrasings: ["How much is the stipend?", "What's the stipend amount?"],
  },
  {
    key: "waiting_periods",
    archetype: "days_waiting",
    titles: ["Health Insurance Enrollment", "Retirement Plan Match", "Life Insurance"],
    phrasings: ["How long is the waiting period?", "How many days is the waiting period before it starts?"],
  },
  {
    key: "daily_spend_limits",
    archetype: "money_cap",
    titles: ["Meal Per Diem", "Lodging Limits", "Corporate Card Use"],
    phrasings: ["What is the daily spending limit?", "How much can I spend per day?"],
  },
  {
    key: "submission_deadlines",
    archetype: "days_deadline",
    titles: ["Expense Report Deadlines", "Mileage Reimbursement", "Tuition Assistance"],
    phrasings: ["What's the deadline to submit my claim?", "How many days do I have to submit?"],
  },
  {
    key: "approval_thresholds",
    archetype: "money_threshold",
    titles: ["Business Travel Booking", "Corporate Card Use", "Client Entertainment"],
    phrasings: ["Above what amount do I need pre-approval?", "What is the pre-approval threshold?"],
  },
];
