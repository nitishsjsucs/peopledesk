import { useRef, useState } from "react";
import { Link } from "react-router";
import type { Team } from "../../shared/api-types.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { OwnBooking } from "../components/OrientationForm.tsx";
import { OnboardingChecklist } from "../components/ToolResultCard.tsx";
import { api, ApiClientError } from "../lib/api.ts";
import { useMe } from "../lib/session.tsx";
import { useAsync } from "../lib/use-async.ts";

const bookUrl = (employeeId: string) => `/requests/orientation?employee=${encodeURIComponent(employeeId)}`;

function OwnChecklist() {
  const progress = useAsync(() => api.onboarding(), []);
  const booking = useAsync(() => api.orientationBooking(), []);
  const noPlan = progress.error instanceof ApiClientError && progress.error.status === 404;
  if (noPlan) return null;
  return (
    <section aria-labelledby="own-onboarding">
      <h2 id="own-onboarding" style={{ fontSize: 17 }}>
        My checklist
      </h2>
      {booking.data ? (
        <div className="banner banner-info" data-testid="own-orientation">
          {booking.data.booking ? (
            <>
              <span>
                <OwnBooking booking={booking.data.booking} />
              </span>
            </>
          ) : (
            <>
              <span>You have not booked an orientation session yet.</span>
              <Link className="btn" to="/requests/orientation">
                Book orientation
              </Link>
            </>
          )}
        </div>
      ) : null}
      {progress.error ? <ErrorBanner error={progress.error} onRetry={progress.reload} /> : null}
      {!progress.data && !progress.error ? (
        <p className="thinking" role="status">
          Loading your checklist...
        </p>
      ) : null}
      {progress.data ? (
        <div className="card">
          <OnboardingChecklist progress={progress.data} />
        </div>
      ) : null}
    </section>
  );
}

type Member = Team["members"][number];
type Filter = "all" | "unbooked" | "blocked";

/** Managers see their direct reports in onboarding; HR sees everyone with a plan (the /api/team slice). */
function TeamOnboarding() {
  const me = useMe();
  const team = useAsync(() => api.team(), []);
  const members = (team.data?.members ?? []).filter((m) => m.inOnboarding);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const checklistRef = useRef<HTMLDivElement>(null);
  const unbooked = members.filter((m) => !m.booked);
  const blocked = members.filter((m) => m.blockedTasks > 0);
  const shown = filter === "unbooked" ? unbooked : filter === "blocked" ? blocked : members;
  const current = shown.find((m) => m.employeeId === selected) ?? shown[0] ?? null;
  const progress = useAsync(() => (current ? api.onboardingFor(current.employeeId) : Promise.resolve(null)), [current?.employeeId]);
  // useAsync keeps the previous result while the next one loads; never show it under another name.
  const checklist = progress.data && !progress.loading && current && progress.data.employeeId === current.employeeId ? progress.data : null;

  function select(m: Member) {
    setSelected(m.employeeId);
    // On a narrow screen the list sits above the checklist, so bring the checklist into view.
    if (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 800px)").matches) {
      checklistRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  }

  const filterButton = (value: Filter, label: string, count: number) => (
    <button type="button" className={`btn filter-btn${filter === value ? " active" : ""}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>
      {label} ({count})
    </button>
  );

  return (
    <section aria-labelledby="team-onboarding">
      <h2 id="team-onboarding" style={{ fontSize: 17 }}>
        {me.role === "hr_admin" ? "Everyone in onboarding" : "Your direct reports in onboarding"}
      </h2>
      {team.error ? <ErrorBanner error={team.error} onRetry={team.reload} /> : null}
      {!team.data && !team.error ? (
        <p className="thinking" role="status">
          Loading the people you support...
        </p>
      ) : null}
      {team.data && members.length === 0 ? <EmptyState title="No one you support is in onboarding" /> : null}
      {members.length > 0 ? (
        <>
          <p className="onboarding-summary" data-testid="onboarding-summary">
            {members.length} in onboarding · {unbooked.length} without orientation · {blocked.length} with blocked tasks
          </p>
          <div className="filters filter-buttons" role="group" aria-label="Show">
            {filterButton("all", "All", members.length)}
            {filterButton("unbooked", "Not booked", unbooked.length)}
            {filterButton("blocked", "Has blocked tasks", blocked.length)}
          </div>
          <div className="onboarding-grid">
            <div className="card onboarding-checklist" ref={checklistRef}>
              {progress.error ? (
                <ErrorBanner error={progress.error} onRetry={progress.reload} />
              ) : checklist ? (
                <OnboardingChecklist progress={checklist} />
              ) : current ? (
                <p className="thinking" role="status">
                  Loading {current.fullName}'s checklist...
                </p>
              ) : (
                <p className="message-meta">No one matches this filter.</p>
              )}
            </div>
            <ul className="policy-list card onboarding-people" aria-label="People in onboarding">
              {shown.map((m) => (
                <li key={m.employeeId} className="person-row">
                  <div className="person-main">
                    <button
                      type="button"
                      className={`person-name${m.employeeId === current?.employeeId ? " active" : ""}`}
                      aria-pressed={m.employeeId === current?.employeeId}
                      onClick={() => select(m)}
                    >
                      {m.fullName}
                    </button>
                    <span className="message-meta">
                      {m.percentComplete ?? 0}% complete
                      {m.blockedTasks > 0 ? ` · ${m.blockedTasks} blocked` : ""}
                    </span>
                  </div>
                  <div className="person-side">
                    <span className={`status-pill ${m.booked ? "done" : "open"}`}>{m.booked ? "orientation booked" : "not booked"}</span>
                    {m.booked ? null : (
                      <Link to={bookUrl(m.employeeId)} aria-label={`Book orientation for ${m.fullName}`}>
                        Book orientation
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}

export function OnboardingPage() {
  const me = useMe();
  return (
    <>
      <h1 className="page-title">Onboarding</h1>
      <p className="page-subtitle">
        Checklists and progress.
        {me.inOnboarding || me.role !== "employee" ? (
          <>
            {" "}
            <Link to="/requests/orientation">Book orientation</Link>
          </>
        ) : null}
      </p>
      {/* /api/me already says whether the caller has a plan; asking for a missing one is a known 404. */}
      {me.inOnboarding ? <OwnChecklist /> : null}
      {me.role === "employee" && !me.inOnboarding ? (
        <EmptyState title="You don't have an onboarding plan">
          <p>Onboarding checklists are for new hires. For anything else, ask in chat or open a ticket.</p>
          <p className="request-links" style={{ justifyContent: "center" }}>
            <Link to="/chat">Ask in chat</Link>
            <Link to="/requests/ticket">Open a ticket</Link>
          </p>
        </EmptyState>
      ) : null}
      {me.role !== "employee" ? <TeamOnboarding /> : null}
    </>
  );
}
