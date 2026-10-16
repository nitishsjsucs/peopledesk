// "Where onboarding is stuck": the checklist steps with blocked or overdue tasks among the people the
// viewer supports, as a table whose bars share one scale. Owner says who owns the step (owner_role),
// relative to the viewer; it is not a claim about who must unblock it. The table, with its caption,
// column headers and printed numbers, is its own text alternative, so the bars are aria-hidden.
import type { OnboardingOverviewStep } from "../../shared/api-types.ts";
import type { OnboardingOwnerRole } from "../../shared/domain.ts";
import { plural } from "../lib/dates.ts";
import { TileIconSvg } from "./StatTiles.tsx";

export type Viewer = "manager" | "hr_admin";

/** Who owns a step, as the viewer would say it: "You" for a manager's own steps, "HR (you)" for HR's. */
export function ownerLabel(role: OnboardingOwnerRole, viewer: Viewer): string {
  if (role === "employee") return "New hire";
  if (role === "it") return "IT";
  if (role === "manager") return viewer === "manager" ? "You" : "Manager";
  return viewer === "hr_admin" ? "HR (you)" : "HR";
}

const ROLE_ORDER: OnboardingOwnerRole[] = ["employee", "manager", "hr_admin", "it"];

/** "46 stuck tasks: 20 blocked, 26 overdue. Owners: New hire 32, Manager 7, HR (you) 5, IT 2", from the rows only. */
export function stuckSummary(steps: readonly OnboardingOverviewStep[], viewer: Viewer): string {
  const blocked = steps.reduce((n, s) => n + s.blocked, 0);
  const overdue = steps.reduce((n, s) => n + s.overdueNotBlocked, 0);
  const byOwner = new Map<OnboardingOwnerRole, number>();
  for (const s of steps) byOwner.set(s.ownerRole, (byOwner.get(s.ownerRole) ?? 0) + s.blocked + s.overdueNotBlocked);
  const owners = [...byOwner.entries()]
    .sort((a, b) => b[1] - a[1] || ROLE_ORDER.indexOf(a[0]) - ROLE_ORDER.indexOf(b[0]))
    .map(([role, n]) => `${ownerLabel(role, viewer)} ${n}`);
  return `${plural(blocked + overdue, "stuck task")}: ${blocked} blocked, ${overdue} overdue. Owners: ${owners.join(", ")}`;
}

/** "Show the 9 people stuck on Enroll in multi-factor authentication" (the count is of people, not tasks). */
export const stepButtonName = (s: OnboardingOverviewStep) =>
  `Show the ${plural(s.employeeIds.length, "person", "people")} stuck on ${s.title}`;

/** A bar's width as a share of the largest value in either bar column; none for 0. */
export function barPercent(value: number, max: number): number | null {
  if (value <= 0 || max <= 0) return null;
  return Math.round((value / max) * 1000) / 10;
}

function BarCell({ value, max, kind }: { value: number; max: number; kind: "blocked" | "overdue" }) {
  const pct = barPercent(value, max);
  return (
    <span className="stuck-cell">
      <span className="stuck-bar-box" aria-hidden="true">
        {pct === null ? null : <span className={`stuck-bar stuck-bar-${kind}`} style={{ width: `${pct}%` }} data-value={value} />}
      </span>
      <span className="stuck-num">{value}</span>
    </span>
  );
}

type Props = {
  steps: OnboardingOverviewStep[];
  viewer: Viewer;
  selectedKey: number | null;
  onShow: (step: OnboardingOverviewStep) => void;
};

export function StuckSteps({ steps, viewer, selectedKey, onShow }: Props) {
  const max = Math.max(0, ...steps.map((s) => Math.max(s.blocked, s.overdueNotBlocked)));
  return (
    <section className="card stuck-steps" aria-labelledby="stuck-title">
      <h3 id="stuck-title" className="stuck-title">
        Where onboarding is stuck
      </h3>
      {steps.length === 0 ? (
        <p className="message-meta" data-testid="stuck-empty">
          Nothing is blocked or overdue.
        </p>
      ) : (
        <>
          <p className="stuck-summary" data-testid="stuck-summary">
            {stuckSummary(steps, viewer)}
          </p>
          <table className="table stuck-table">
            <caption className="visually-hidden">Where onboarding is stuck</caption>
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col" className="col-owner">
                  Owner
                </th>
                <th scope="col">
                  <span className="th-icon">
                    <TileIconSvg icon="blocked" />
                    Blocked
                  </span>
                </th>
                <th scope="col">
                  <span className="th-icon">
                    <TileIconSvg icon="clock" />
                    Overdue, not blocked
                  </span>
                </th>
                <th scope="col" className="col-due">
                  Due in 7 days
                </th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s) => (
                <tr key={s.stepKey} data-testid={`step-${s.stepKey}`}>
                  <td className="stuck-step">
                    <button type="button" className="step-name" aria-label={stepButtonName(s)} aria-pressed={selectedKey === s.stepKey} onClick={() => onShow(s)}>
                      {s.title}
                    </button>
                    {/* On a phone the Owner and Due columns fold into this line. */}
                    <span className="step-sub">
                      {ownerLabel(s.ownerRole, viewer)} · {s.dueNext7} due in 7 days
                    </span>
                  </td>
                  <td className="col-owner">{ownerLabel(s.ownerRole, viewer)}</td>
                  <td>
                    <BarCell value={s.blocked} max={max} kind="blocked" />
                  </td>
                  <td>
                    <BarCell value={s.overdueNotBlocked} max={max} kind="overdue" />
                  </td>
                  <td className="col-due stuck-num">{s.dueNext7}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
