import { Link } from "react-router";
import type { OnboardingOverview, OnboardingProgress, OrientationBooking } from "../../shared/api-types.ts";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { StatTiles } from "../components/StatTiles.tsx";
import type { Tile } from "../components/StatTiles.tsx";
import { TaskBar, TaskBarLegend } from "../components/TaskBar.tsx";
import { api } from "../lib/api.ts";
import { useBusinessDate } from "../lib/business-date.tsx";
import { groupChecklist, nextForYou, waitingText } from "../lib/checklist.ts";
import type { GroupedChecklist } from "../lib/checklist.ts";
import { relativeDays } from "../lib/dates.ts";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { matchesShow } from "../lib/onboarding-overview.ts";
import { useMe } from "../lib/session.tsx";
import { useAsync } from "../lib/use-async.ts";

const ROLE_LABEL = { employee: "Employee", manager: "Manager", hr_admin: "HR admin" } as const;

type QuickAction = { to: string; title: string; hint: string; testId?: string };

const people = (n: number) => (n === 1 ? "1 person needs an orientation session" : `${n} people need an orientation session`);

/** "Book orientation. Your orientation task was due Sep 21, 2026." or "Enroll in ..., overdue since Sep 22, 2026". */
function nextStepText(grouped: GroupedChecklist): string {
  const next = nextForYou(grouped);
  if (!next) return "Nothing is waiting on you.";
  const due = formatDate(next.task.dueDate);
  if (next.action === "book") return `Book orientation. Your orientation task ${next.overdue ? "was" : "is"} due ${due}.`;
  if (next.overdue) return `${next.task.title}, overdue since ${due}`;
  if (next.dueToday) return `${next.task.title}, due today`;
  return `${next.task.title}, due ${due}`;
}

type PanelProps = {
  progress: OnboardingProgress | null;
  progressError: unknown;
  onRetry: () => void;
  /** undefined while the booking is loading or could not be checked. */
  booking: OrientationBooking | null | undefined;
  asOf: string | null;
};

/**
 * A new hire's onboarding at a glance: the task bar with done, overdue and waiting counts, the next
 * thing to do, and the orientation booking. Before the business date is known (or when /api/health
 * failed) it shows done counts only, and never says overdue.
 */
function YourOnboarding({ progress, progressError, onRetry, booking, asOf }: PanelProps) {
  const grouped = progress && asOf && booking !== undefined ? groupChecklist(progress, { relation: "self", asOf, booked: booking !== null }) : null;
  const done = progress ? progress.tasks.filter((t) => t.status === "done").length : 0;
  const line = progress
    ? [`${done} of ${progress.tasks.length} done`, ...(grouped && grouped.overdue > 0 ? [`${grouped.overdue} overdue`] : []), ...(grouped && waitingText(grouped.waiting) ? [waitingText(grouped.waiting) as string] : [])].join(" · ")
    : "";
  return (
    <section className="card home-panel" aria-labelledby="home-onboarding" data-testid="your-onboarding">
      <h2 id="home-onboarding" className="home-panel-title">
        Your onboarding
      </h2>
      {progressError ? <ErrorBanner context="Could not load your checklist." error={progressError} onRetry={onRetry} /> : null}
      {!progress && !progressError ? (
        <p className="thinking" role="status">
          Loading your onboarding...
        </p>
      ) : null}
      {progress ? (
        <>
          <TaskBar counts={{ total: progress.tasks.length, done, overdue: grouped ? grouped.overdue : null }} text={line} testId="home-task-bar" />
          <TaskBarLegend overdue={grouped !== null} />
          {grouped ? (
            <p className="home-next" data-testid="next-for-you">
              <strong>Next for you:</strong> {nextStepText(grouped)}
            </p>
          ) : null}
        </>
      ) : null}
      {booking !== undefined ? (
        <p className="home-orientation" data-testid="home-orientation">
          {booking ? `Orientation: ${formatDateTime(booking.startsAt)}${asOf ? `, ${relativeDays(booking.startsAt, asOf)}` : ""}` : "Orientation: not booked yet."}
        </p>
      ) : null}
      <p className="request-links home-links">
        {booking === null ? (
          <Link className="btn btn-primary" to="/requests/orientation">
            Book orientation
          </Link>
        ) : null}
        <Link to="/onboarding">View checklist</Link>
      </p>
    </section>
  );
}

/** For a manager or HR admin with people in onboarding: counts that open the filtered Onboarding view. */
function TeamPanel({ overview }: { overview: OnboardingOverview }) {
  const count = (show: "unbooked" | "blocked" | "overdue") => overview.people.filter((p) => matchesShow(p, show)).length;
  const tile = (show: "unbooked" | "blocked" | "overdue", label: string, hint: (n: number) => string, icon: Tile["icon"]): Tile => {
    const n = count(show);
    return { key: show, count: n, label, hint: hint(n), icon: n === 0 ? "check" : icon, href: `/onboarding?show=${show}` };
  };
  return (
    <section className="card home-panel" aria-labelledby="home-team" data-testid="team-onboarding">
      <div className="home-panel-head">
        <h2 id="home-team" className="home-panel-title">
          Onboarding
        </h2>
        <p className="home-panel-count">
          {overview.people.length} in onboarding · <Link to="/onboarding">See everyone</Link>
        </p>
      </div>
      <StatTiles
        mode="link"
        label="People in onboarding"
        tiles={[
          tile("unbooked", "not booked", (n) => ` who ${n === 1 ? "needs" : "need"} orientation, show them`, "calendar"),
          tile("blocked", "with blocked tasks", () => ", show them", "blocked"),
          tile("overdue", "with overdue tasks", () => ", show them", "clock"),
        ]}
      />
    </section>
  );
}

/**
 * Greeting, the number of requests waiting for the user's approval, an onboarding panel that fits the
 * person (a new hire's own plan, or a manager's or HR's people in onboarding), and quick actions:
 * Book orientation only when someone the viewer books for still needs a session. When the booking or
 * the team cannot be checked, an error with Try again says so, instead of a card quietly missing.
 */
export function HomePage() {
  const me = useMe();
  const { asOf } = useBusinessDate();
  const pending = useAsync(() => api.actions("awaiting_approval"), []);
  const booking = useAsync(() => (me.inOnboarding ? api.orientationBooking() : Promise.resolve(null)), [me.inOnboarding]);
  const progress = useAsync(() => (me.inOnboarding ? api.onboarding() : Promise.resolve(null)), [me.inOnboarding]);
  const overview = useAsync(() => (me.role === "employee" ? Promise.resolve(null) : api.teamOnboarding()), [me.role]);
  const waiting = pending.data?.actions.length ?? 0;

  const teamPeople = overview.data?.people ?? [];
  const teamUnbooked = teamPeople.filter((p) => p.orientation === null && p.employeeId !== me.employeeId).length;
  const showTeamPanel = teamPeople.length > 0;

  const quick: QuickAction[] = [{ to: "/chat", title: "Ask a question", hint: "Policy answers cite the version they come from." }];
  if (teamUnbooked > 0) {
    quick.push({ to: "/requests/orientation", title: "Book orientation", hint: `${people(teamUnbooked)}.`, testId: "quick-book-orientation" });
  }
  if (me.role !== "employee" && !showTeamPanel) {
    const scope = me.role === "hr_admin" ? "Everyone in onboarding" : "Your direct reports in onboarding";
    quick.push({ to: "/onboarding", title: "Onboarding", hint: me.inOnboarding ? `${scope}, and your own checklist.` : `${scope}.`, testId: "quick-onboarding" });
  }
  quick.push(
    { to: "/requests/ticket", title: "New ticket", hint: "IT, payroll, benefits, facilities, HR or access." },
    { to: "/tickets", title: "My tickets", hint: "The tickets you opened and their status." },
    { to: "/policies", title: "Policies", hint: "Every policy you can read, at the version in effect today." },
  );

  return (
    <>
      <h1 className="page-title">
        Hello, {me.fullName.split(" ")[0]} <span className="role-badge">{ROLE_LABEL[me.role]}</span>
      </h1>
      <p className="page-subtitle">
        {me.jobTitle}, {me.department}
      </p>
      {pending.error ? <ErrorBanner error={pending.error} onRetry={pending.reload} /> : null}
      {!pending.data && !pending.error ? (
        <p className="thinking" role="status">
          Checking for requests waiting for your approval...
        </p>
      ) : null}
      {pending.data ? (
        <div className={`banner ${waiting > 0 ? "banner-info" : ""}`} data-testid="pending-count">
          <span>
            {waiting === 0
              ? "No requests are waiting for your approval."
              : `${waiting} ${waiting === 1 ? "request is" : "requests are"} waiting for your approval.`}
          </span>
          {waiting > 0 ? (
            <Link className="btn" to="/actions">
              Review
            </Link>
          ) : null}
        </div>
      ) : null}
      {booking.error ? <ErrorBanner context="Could not check your orientation booking." error={booking.error} onRetry={booking.reload} /> : null}
      {overview.error ? (
        <ErrorBanner context="Could not check who you support still needs an orientation session." error={overview.error} onRetry={overview.reload} />
      ) : null}
      {me.inOnboarding ? (
        <YourOnboarding
          progress={progress.data}
          progressError={progress.error}
          onRetry={progress.reload}
          booking={booking.data ? booking.data.booking : undefined}
          asOf={asOf}
        />
      ) : null}
      {showTeamPanel && overview.data ? <TeamPanel overview={overview.data} /> : null}
      <div className="quick-actions">
        {quick.map(({ to, title, hint, testId }) => (
          <Link key={title} to={to} className="card quick-action" data-testid={testId}>
            <strong>{title}</strong>
            <span className="message-meta">{hint}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
