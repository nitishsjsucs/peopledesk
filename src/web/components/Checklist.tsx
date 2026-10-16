// An onboarding checklist as next steps, for the person's own checklist and the manager and HR
// checklist pane: a plan header (the task bar and "Day 55 of 90 · target ... · 9 of 12 done · 3
// overdue", then the orientation line), and the tasks grouped by what to do now, what is coming, what
// waits on someone else, and Done (folded). The chat's onboarding card is OnboardingChecklist, unchanged.
import { useId } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { OnboardingProgress, OrientationBooking } from "../../shared/api-types.ts";
import { groupChecklist, planLine } from "../lib/checklist.ts";
import type { ChecklistItem, Relation } from "../lib/checklist.ts";
import { relativeDays } from "../lib/dates.ts";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { OwnBooking } from "./OrientationForm.tsx";
import { TaskBar, TaskBarLegend } from "./TaskBar.tsx";

type Props = {
  progress: OnboardingProgress;
  relation: Relation;
  asOf: string;
  /** Whether the person has an orientation booking; null when it could not be checked. */
  booked: boolean | null;
  /** The orientation line under the plan line (OrientationLine). */
  orientation?: ReactNode;
  /** h3 under My checklist's h2; h4 under the pane's h3. */
  headingLevel: 3 | 4;
  bookHref: string;
  /** The Book orientation link's name when the person is someone else ("Book orientation for ..."). */
  bookLabel?: string;
};

const STATUS_LABEL: Record<OnboardingProgress["tasks"][number]["status"], string> = {
  pending: "pending",
  in_progress: "in progress",
  blocked: "blocked",
  done: "done",
};

function dueText(item: ChecklistItem): ReactNode {
  if (item.overdue) {
    return (
      <>
        Due {formatDate(item.task.dueDate)}, <span className="task-overdue">overdue</span>
      </>
    );
  }
  if (item.dueToday && item.task.status !== "done") return "Due today";
  return `Due ${formatDate(item.task.dueDate)}`;
}

function TaskItem({ item, bookHref, bookLabel }: { item: ChecklistItem; bookHref: string; bookLabel?: string }) {
  return (
    <li className="task-item">
      <div className="task-row">
        <span className="task-title">{item.task.title}</span>
        {item.action === "book" ? (
          <Link className="task-action" to={bookHref} aria-label={bookLabel}>
            Book orientation
          </Link>
        ) : item.action === "ticket" ? (
          <Link className="task-action" to="/requests/ticket">
            Open a ticket
          </Link>
        ) : null}
      </div>
      <div className="task-meta">
        {item.owner} · {dueText(item)} · <span className={`status-pill ${item.task.status}`}>{STATUS_LABEL[item.task.status]}</span>
      </div>
    </li>
  );
}

export function Checklist({ progress, relation, asOf, booked, orientation, headingLevel, bookHref, bookLabel }: Props) {
  const grouped = groupChecklist(progress, { relation, asOf, booked });
  const id = useId();
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <div className="checklist" data-testid="grouped-checklist">
      <div className="plan-header">
        <TaskBar counts={{ total: grouped.total, done: grouped.done, overdue: grouped.overdue }} text={planLine(progress, grouped, asOf)} testId="plan-bar" />
        <TaskBarLegend />
        {orientation}
      </div>
      {grouped.groups.map((g) =>
        g.key === "done" ? (
          <details key={g.key} className="checklist-group checklist-done" data-group="done">
            <summary>
              {g.title} ({g.items.length})
            </summary>
            <ul className="task-list">
              {g.items.map((item) => (
                <TaskItem key={item.task.id} item={item} bookHref={bookHref} bookLabel={bookLabel} />
              ))}
            </ul>
          </details>
        ) : (
          <section key={g.key} className="checklist-group" data-group={g.key} aria-labelledby={`${id}-${g.key}`}>
            <Heading id={`${id}-${g.key}`} className="checklist-group-title">
              {g.title} ({g.items.length})
            </Heading>
            <ul className="task-list">
              {g.items.map((item) => (
                <TaskItem key={item.task.id} item={item} bookHref={bookHref} bookLabel={bookLabel} />
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

type OrientationLineProps = {
  asOf: string | null;
  /** The orientation task's due date, if the plan has one. */
  taskDue: string | null;
  /** Whether the orientation task is done: without a booking, there is then nothing to book. */
  taskDone?: boolean;
  bookHref: string;
} & (
  | { who: "self"; booking: OrientationBooking | null }
  | { who: "report"; fullName: string; booking: { sessionId: string; startsAt: string } | null }
);

/**
 * Whether orientation is booked, and when; that the orientation task is done when there is no booking;
 * or Book orientation, with the task's due date once it has passed.
 */
export function OrientationLine(props: OrientationLineProps) {
  const { asOf, taskDue, taskDone = false, bookHref } = props;
  const pastDue = asOf !== null && taskDue !== null && taskDue < asOf;
  if (props.who === "self") {
    return (
      <div className="plan-orientation" data-testid="own-orientation">
        {props.booking ? (
          <span>
            <OwnBooking booking={props.booking} asOf={asOf} />
          </span>
        ) : taskDone ? (
          <span>Your orientation task is done, so there is no session to book.</span>
        ) : (
          <>
            <span>
              You have not booked an orientation session yet.{pastDue ? ` Your orientation task was due ${formatDate(taskDue)}.` : ""}
            </span>
            <Link className="btn" to={bookHref}>
              Book orientation
            </Link>
          </>
        )}
      </div>
    );
  }
  const first = props.fullName.split(" ")[0];
  return (
    <div className="plan-orientation" data-testid="report-orientation">
      {props.booking ? (
        <span>
          Orientation: {props.booking.sessionId} on {formatDateTime(props.booking.startsAt)}
          {asOf ? ` (${relativeDays(props.booking.startsAt, asOf)})` : ""}.
        </span>
      ) : taskDone ? (
        <span>{first}'s orientation task is done, so there is no session to book.</span>
      ) : (
        <>
          <span>
            {first} has not booked an orientation session yet.{pastDue ? ` The orientation task was due ${formatDate(taskDue)}.` : ""}
          </span>
          <Link className="btn" to={bookHref} aria-label={`Book orientation for ${props.fullName}`}>
            Book orientation
          </Link>
        </>
      )}
    </div>
  );
}
