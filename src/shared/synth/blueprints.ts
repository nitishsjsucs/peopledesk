// 100 compact policy blueprints: title, category, audience and 2 or 3 (archetype, subject phrase)
// pairs. The subject phrase is the only per-fact authored text; sentences, questions and change
// summaries come from the archetype templates. Rows are ordered by category, and within a category
// 7 `all`, 2 `managers`, 1 `hr`, so POL-001..POL-010 are time_off, POL-011..POL-020 benefits, etc.
//
// Authoring rules (checked by synth.corpus.test.ts):
// - subjects are lowercase and contain no digits or number words, so they add no numeric tokens;
// - among `all` documents, accrual_rate, days_waiting and money_threshold appear only in the
//   ambiguity-group documents that share them, so group questions have exactly those candidates.
import type { Audience, PolicyCategory } from "../domain.ts";
import type { ArchetypeKey } from "./archetypes.ts";

export type Blueprint = {
  title: string;
  category: PolicyCategory;
  audience: Audience;
  facts: ReadonlyArray<readonly [ArchetypeKey, string]>;
};

type Row = readonly [string, PolicyCategory, Audience, ReadonlyArray<readonly [ArchetypeKey, string]>];

const ROWS: readonly Row[] = [
  // time_off
  ["PTO Accrual", "time_off", "all", [["accrual_rate", "paid time off"], ["notice_weeks", "a planned vacation week"]]],
  ["Sick Leave", "time_off", "all", [["accrual_rate", "sick leave"], ["days_deadline", "sick note delivery"], ["count_per_year", "sick leave without a doctor's note"]]],
  ["Parental Leave", "time_off", "all", [["notice_weeks", "a parental leave request"], ["days_deadline", "birth certificate filing for parental leave"]]],
  ["Bereavement Leave", "time_off", "all", [["count_per_year", "bereavement leave use"], ["days_deadline", "bereavement leave documentation"]]],
  ["Public Holidays", "time_off", "all", [["count_per_year", "floating holiday use"], ["notice_weeks", "a floating holiday request"]]],
  ["Leave Carryover", "time_off", "all", [["days_deadline", "use of carried-over leave"], ["money_cap", "payout for unused leave"]]],
  ["Jury Duty and Civic Leave", "time_off", "all", [["count_per_year", "paid civic leave use"], ["notice_weeks", "a jury duty leave request"], ["hours", "voting leave"]]],
  ["Leave Approval Standards", "time_off", "managers", [["days_deadline", "manager review of a leave request"], ["count_per_year", "leave request escalation to a director"], ["hours", "leave approver training"]]],
  ["Team Coverage Planning", "time_off", "managers", [["notice_weeks", "a coverage plan for extended leave"], ["hours", "coverage handover documentation"]]],
  ["Leave Investigation Procedures", "time_off", "hr", [["days_deadline", "a leave abuse investigation"], ["hours", "investigator interview preparation"]]],

  // benefits
  ["Health Insurance Enrollment", "benefits", "all", [["days_waiting", "health plan coverage"], ["days_deadline", "health plan enrollment"], ["count_per_year", "plan change outside open enrollment"]]],
  ["Dental and Vision Coverage", "benefits", "all", [["money_cap", "annual vision frame allowance"], ["count_per_year", "covered dental cleaning visit"]]],
  ["Retirement Plan Match", "benefits", "all", [["percent", "the retirement plan match"], ["days_waiting", "retirement plan matching"], ["days_deadline", "a retirement contribution change"]]],
  ["Wellness Stipend", "benefits", "all", [["money_cap", "annual wellness stipend"], ["count_per_year", "wellness stipend reimbursement request"], ["days_deadline", "wellness receipt upload"]]],
  ["Employee Assistance Program", "benefits", "all", [["count_per_year", "free counseling session"], ["days_deadline", "counselor assignment after a request"]]],
  ["Commuter Benefits", "benefits", "all", [["money_cap", "monthly transit pass subsidy"], ["days_deadline", "a commuter benefit election change"], ["count_per_year", "parking permit replacement"]]],
  ["Life Insurance", "benefits", "all", [["days_waiting", "life insurance coverage"], ["money_cap", "supplemental life insurance premium subsidy"]]],
  ["Benefits Escalation for Managers", "benefits", "managers", [["days_deadline", "escalation of an unresolved benefits case"], ["count_per_year", "benefits exception request per team"]]],
  ["Return-to-Work Accommodations", "benefits", "managers", [["notice_weeks", "a return-to-work accommodation plan"], ["money_cap", "accommodation equipment budget"], ["days_deadline", "an accommodation decision"]]],
  ["Benefits Vendor Audit", "benefits", "hr", [["days_deadline", "a benefits vendor audit"], ["percent", "the vendor sampling rate"]]],

  // compensation
  ["Payroll Schedule", "compensation", "all", [["days_deadline", "timesheet approval before payroll"], ["count_per_year", "off-cycle payroll run"]]],
  ["Overtime Eligibility", "compensation", "all", [["hours", "overtime eligibility in a work week"], ["percent", "the overtime premium"], ["count_per_year", "weekend overtime shift"]]],
  ["Referral Bonus", "compensation", "all", [["money_cap", "referral bonus for a hire"], ["count_per_year", "paid referral per employee"]]],
  ["Shift Differential", "compensation", "all", [["percent", "the night shift differential"], ["hours", "a qualifying night shift"]]],
  ["Pay Statement Corrections", "compensation", "all", [["days_deadline", "pay statement error reporting"], ["money_cap", "emergency pay advance"]]],
  ["Stock Vesting Basics", "compensation", "all", [["percent", "the employee stock purchase discount"], ["count_per_year", "stock purchase enrollment window"]]],
  ["Final Pay", "compensation", "all", [["days_deadline", "final pay processing"], ["notice_weeks", "a voluntary resignation"]]],
  ["Merit Increase Guidelines", "compensation", "managers", [["percent", "the maximum merit increase"], ["days_deadline", "a merit recommendation"]]],
  ["Spot Bonus Approval", "compensation", "managers", [["money_cap", "spot bonus per award"], ["count_per_year", "spot bonus per employee"], ["days_deadline", "spot bonus payout"]]],
  ["Salary Band Administration", "compensation", "hr", [["percent", "the salary band spread"], ["days_deadline", "a salary band review"], ["money_cap", "salary band exception adjustment"]]],

  // travel_expense
  ["Business Travel Booking", "travel_expense", "all", [["money_threshold", "airfare bookings"], ["notice_weeks", "booking international travel"], ["money_cap", "airline seat upgrade reimbursement"]]],
  ["Meal Per Diem", "travel_expense", "all", [["money_cap", "daily meal allowance on business trips"], ["hours", "a trip that qualifies for the meal allowance"]]],
  ["Lodging Limits", "travel_expense", "all", [["money_cap", "nightly hotel rate"], ["days_deadline", "hotel cancellation"], ["count_per_year", "hotel stay above the nightly rate"]]],
  ["Mileage Reimbursement", "travel_expense", "all", [["days_deadline", "mileage claim submission"], ["money_cap", "monthly mileage reimbursement"]]],
  ["Expense Report Deadlines", "travel_expense", "all", [["days_deadline", "expense report submission"], ["count_per_year", "late expense report exception"], ["money_cap", "receipt-free expense"]]],
  ["Corporate Card Use", "travel_expense", "all", [["money_threshold", "single card purchases"], ["money_cap", "daily corporate card spend"], ["days_deadline", "corporate card statement reconciliation"]]],
  ["Client Entertainment", "travel_expense", "all", [["money_threshold", "client entertainment events"], ["money_cap", "entertainment spend per guest"]]],
  ["Travel Pre-Approval Thresholds", "travel_expense", "managers", [["money_threshold", "team offsite bookings"], ["days_deadline", "manager sign-off on a travel request"]]],
  ["Expense Approval Duties", "travel_expense", "managers", [["days_deadline", "manager expense approval"], ["money_threshold", "team expense reports"], ["hours", "expense approver training"]]],
  ["Expense Fraud Review", "travel_expense", "hr", [["days_deadline", "an expense fraud review"], ["money_threshold", "flagged expense reimbursements"], ["count_per_year", "expense audit sampling round"]]],

  // remote_work
  ["Hybrid Work Schedule", "remote_work", "all", [["hours", "weekly in-office presence"], ["notice_weeks", "a change to your hybrid schedule"], ["count_per_year", "fully remote week"]]],
  ["Home Office Stipend", "remote_work", "all", [["money_cap", "home office setup stipend"], ["count_per_year", "home office equipment refresh"]]],
  ["Equipment Return", "remote_work", "all", [["days_deadline", "equipment return after separation"], ["money_cap", "charge for unreturned equipment"]]],
  ["Working From Another Country", "remote_work", "all", [["days_deadline", "a single work-from-abroad stay"], ["notice_weeks", "a work-from-abroad request"]]],
  ["Core Collaboration Hours", "remote_work", "all", [["hours", "daily core collaboration time"], ["count_per_year", "core hours exemption"]]],
  ["Internet Reimbursement", "remote_work", "all", [["money_cap", "monthly internet reimbursement"], ["days_deadline", "internet bill upload"], ["count_per_year", "internet speed upgrade"]]],
  ["Coworking Space Access", "remote_work", "all", [["count_per_year", "coworking day pass use"], ["money_cap", "coworking membership reimbursement"]]],
  ["Remote Team Check-ins", "remote_work", "managers", [["count_per_year", "in-person team gathering"], ["hours", "remote team check-in time per quarter"]]],
  ["Hybrid Exception Approvals", "remote_work", "managers", [["days_deadline", "a decision on a hybrid exception"], ["count_per_year", "hybrid exception approval per team member"]]],
  ["Remote Work Tax Compliance", "remote_work", "hr", [["days_deadline", "a remote work tax review"], ["count_per_year", "cross-border tax filing check"]]],

  // it_security
  ["Password and MFA", "it_security", "all", [["days_deadline", "password rotation"], ["count_per_year", "multi-factor device reset"]]],
  ["Device Encryption", "it_security", "all", [["days_deadline", "disk encryption on a new laptop"], ["count_per_year", "encryption key recovery request"]]],
  ["Acceptable Use", "it_security", "all", [["hours", "the acceptable use refresher course"], ["count_per_year", "personal software exception"]]],
  ["Phishing Reporting", "it_security", "all", [["hours", "phishing awareness training"], ["count_per_year", "phishing simulation"], ["days_deadline", "phishing email reporting"]]],
  ["Software Installation Requests", "it_security", "all", [["days_deadline", "security review of a software request"], ["money_cap", "self-service software purchase"]]],
  ["Data Classification", "it_security", "all", [["days_deadline", "labeling newly created confidential files"], ["hours", "data handling training"]]],
  ["Lost Device Reporting", "it_security", "all", [["days_deadline", "lost device reporting"], ["money_cap", "replacement device deductible"]]],
  ["Quarterly Access Reviews", "it_security", "managers", [["days_deadline", "a quarterly access review"], ["count_per_year", "access review reminder"]]],
  ["Offboarding Access Removal", "it_security", "managers", [["days_deadline", "manager confirmation of access removal"], ["hours", "an offboarding access audit"]]],
  ["Insider Risk Investigations", "it_security", "hr", [["days_deadline", "an insider risk investigation"], ["hours", "insider risk case documentation"], ["count_per_year", "insider risk audit"]]],

  // conduct
  ["Code of Conduct", "conduct", "all", [["hours", "code of conduct training"], ["days_deadline", "code of conduct attestation"], ["count_per_year", "conduct policy acknowledgment"]]],
  ["Anti-Harassment", "conduct", "all", [["hours", "anti-harassment training"], ["days_deadline", "harassment complaint acknowledgment"]]],
  ["Conflicts of Interest", "conduct", "all", [["days_deadline", "conflict of interest disclosure"], ["money_cap", "outside business investment without disclosure"]]],
  ["Gifts and Hospitality", "conduct", "all", [["money_cap", "value of a gift from a vendor"], ["count_per_year", "vendor hospitality acceptance"], ["days_deadline", "gift declaration"]]],
  ["Social Media Use", "conduct", "all", [["hours", "social media guidelines training"], ["days_deadline", "removal of a flagged social media post"]]],
  ["Whistleblower Reporting", "conduct", "all", [["days_deadline", "whistleblower report acknowledgment"], ["count_per_year", "anonymous hotline audit"]]],
  ["Open Door Policy", "conduct", "all", [["days_deadline", "a response to an open door request"], ["count_per_year", "skip-level meeting"]]],
  ["Handling Misconduct Reports", "conduct", "managers", [["days_deadline", "escalation of a misconduct report"], ["hours", "misconduct intake training for managers"]]],
  ["Corrective Action Documentation", "conduct", "managers", [["days_deadline", "written warning documentation"], ["count_per_year", "corrective action review"]]],
  ["Investigation Case Management", "conduct", "hr", [["days_deadline", "closing an investigation case"], ["hours", "investigation case file review"], ["money_cap", "external investigator engagement"]]],

  // onboarding_learning
  ["New Hire Onboarding Checklist", "onboarding_learning", "all", [["days_deadline", "the new hire onboarding checklist"], ["hours", "self-paced onboarding modules"]]],
  ["Orientation Attendance", "onboarding_learning", "all", [["hours", "new hire orientation attendance"], ["days_deadline", "orientation completion after the start date"]]],
  ["Buddy Program", "onboarding_learning", "all", [["hours", "the buddy program time commitment"], ["days_deadline", "buddy assignment"], ["count_per_year", "buddy lunch reimbursement"]]],
  ["Learning Budget", "onboarding_learning", "all", [["money_cap", "annual learning budget"], ["count_per_year", "conference attendance"], ["days_deadline", "learning budget course approval"]]],
  ["Tuition Assistance", "onboarding_learning", "all", [["money_cap", "annual tuition assistance"], ["days_deadline", "tuition reimbursement claim submission"], ["notice_weeks", "a tuition assistance application"]]],
  ["Mandatory Compliance Training", "onboarding_learning", "all", [["hours", "mandatory compliance training"], ["days_deadline", "mandatory compliance training completion"]]],
  ["Internal Mobility", "onboarding_learning", "all", [["count_per_year", "internal transfer application"], ["notice_weeks", "an internal transfer"]]],
  ["Manager Onboarding Responsibilities", "onboarding_learning", "managers", [["days_deadline", "a new hire's first manager check-in"], ["hours", "manager preparation for a new hire"]]],
  ["Probation Review Process", "onboarding_learning", "managers", [["days_deadline", "a probation review"], ["count_per_year", "probation extension"]]],
  ["Background Check Procedures", "onboarding_learning", "hr", [["days_deadline", "a background check"], ["money_cap", "background check vendor fee"], ["count_per_year", "background check rescreening"]]],

  // health_safety
  ["Workplace Safety", "health_safety", "all", [["hours", "workplace safety training"], ["count_per_year", "fire drill"], ["days_deadline", "hazard report follow-up"]]],
  ["Incident Reporting", "health_safety", "all", [["days_deadline", "incident reporting"], ["hours", "near-miss report review"]]],
  ["Ergonomics Assessment", "health_safety", "all", [["money_cap", "ergonomic equipment allowance"], ["count_per_year", "ergonomics assessment"], ["days_deadline", "ergonomic assessment scheduling"]]],
  ["Emergency Evacuation", "health_safety", "all", [["count_per_year", "evacuation drill"], ["hours", "floor warden training"]]],
  ["First Aid Coverage", "health_safety", "all", [["hours", "first aid certification training"], ["count_per_year", "first aid kit inspection"]]],
  ["Travel Safety", "health_safety", "all", [["days_deadline", "travel safety registration before a trip"], ["money_cap", "emergency travel assistance advance"]]],
  ["Mental Health Days", "health_safety", "all", [["accrual_rate", "mental health day credit"], ["count_per_year", "same-day mental health day use"]]],
  ["Safety Inspections for Managers", "health_safety", "managers", [["count_per_year", "workspace safety inspection"], ["days_deadline", "fixing an inspection finding"]]],
  ["Incident Investigation Duties", "health_safety", "managers", [["days_deadline", "a manager incident investigation"], ["hours", "incident investigation training"]]],
  ["Workers Compensation Claims", "health_safety", "hr", [["days_deadline", "filing a workers compensation report with the insurer"], ["percent", "the workers compensation wage replacement"]]],

  // performance
  ["Performance Review Cycle", "performance", "all", [["count_per_year", "formal performance review"], ["days_deadline", "a manager review write-up"]]],
  ["Goal Setting", "performance", "all", [["days_deadline", "quarterly goal setting"], ["count_per_year", "goal revision"]]],
  ["Promotion Process", "performance", "all", [["count_per_year", "promotion cycle"], ["notice_weeks", "a promotion nomination"]]],
  ["Feedback Guidelines", "performance", "all", [["count_per_year", "peer feedback request"], ["days_deadline", "written feedback after a project ends"]]],
  ["Recognition Program", "performance", "all", [["money_cap", "peer recognition award"], ["count_per_year", "peer recognition nomination"], ["days_deadline", "recognition award payout"]]],
  ["Career Levels Overview", "performance", "all", [["hours", "annual career development planning"], ["count_per_year", "career conversation with your manager"]]],
  ["Self-Assessment", "performance", "all", [["days_deadline", "self-assessment completion"], ["hours", "self-assessment preparation"]]],
  ["Calibration Guidelines", "performance", "managers", [["count_per_year", "calibration session"], ["days_deadline", "calibration rating changes"]]],
  ["Performance Improvement Plans", "performance", "managers", [["days_deadline", "a performance improvement plan"], ["count_per_year", "improvement plan check-in"]]],
  ["Promotion Budget Allocation", "performance", "hr", [["percent", "the promotion budget"], ["days_deadline", "promotion budget reconciliation"]]],
];

export const BLUEPRINTS: readonly Blueprint[] = ROWS.map(([title, category, audience, facts]) => ({
  title,
  category,
  audience,
  facts,
}));

export const OWNER_TEAMS: Readonly<Record<PolicyCategory, string>> = {
  time_off: "People Operations",
  benefits: "Total Rewards",
  compensation: "Payroll and Compensation",
  travel_expense: "Finance",
  remote_work: "Workplace Experience",
  it_security: "IT Security",
  conduct: "Employee Relations",
  onboarding_learning: "Learning and Development",
  health_safety: "Workplace Safety",
  performance: "Talent Management",
};

/** POL-001 .. POL-100 in blueprint order. */
export function docIdFor(index: number): string {
  return `POL-${String(index + 1).padStart(3, "0")}`;
}
