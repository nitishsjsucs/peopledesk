import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { OnboardingOverview, OnboardingOverviewPerson, OnboardingOverviewStep } from "../../shared/api-types.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { Checklist, OrientationLine } from "../components/Checklist.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { OwnBooking } from "../components/OrientationForm.tsx";
import { StatTiles } from "../components/StatTiles.tsx";
import { StuckSteps } from "../components/StuckSteps.tsx";
import type { Tile } from "../components/StatTiles.tsx";
import { TaskBar, TaskBarLegend } from "../components/TaskBar.tsx";
import { OnboardingChecklist } from "../components/ToolResultCard.tsx";
import { api, ApiClientError } from "../lib/api.ts";
import { useBusinessDate } from "../lib/business-date.tsx";
import { formatShortDate } from "../lib/format.ts";
import { EMPTY_FILTER_TEXT, matchesShow, personLine, SHOW_FILTERS, SORT_LABEL, SORTS, sortPeople } from "../lib/onboarding-overview.ts";
import type { ShowFilter, SortOrder } from "../lib/onboarding-overview.ts";
import { useMe } from "../lib/session.tsx";
import { useAsync } from "../lib/use-async.ts";

const bookUrl = (employeeId: string) => `/requests/orientation?employee=${encodeURIComponent(employeeId)}`;

/**
 * The viewer's own checklist as next steps (Checklist), once the checklist, the booking and the business
 * date have settled, so the layout never swaps from a table to groups. Without a business date
 * (/api/health failed) it is today's ungrouped table, and nothing is called overdue.
 */
function OwnChecklist() {
  const { asOf, settled } = useBusinessDate();
  const progress = useAsync(() => api.onboarding(), []);
  const booking = useAsync(() => api.orientationBooking(), []);
  const noPlan = progress.error instanceof ApiClientError && progress.error.status === 404;
  if (noPlan) return null;
  const ready = progress.data !== null && settled && (booking.data !== null || Boolean(booking.error));
  const ownBooking = booking.data?.booking ?? null;
  return (
    <section aria-labelledby="own-onboarding">
      <h2 id="own-onboarding" style={{ fontSize: 17 }}>
        My checklist
      </h2>
      {booking.error ? <ErrorBanner error={booking.error} onRetry={booking.reload} /> : null}
      {progress.error ? <ErrorBanner error={progress.error} onRetry={progress.reload} /> : null}
      {!progress.error && !ready ? (
        <p className="thinking" role="status">
          Loading your checklist...
        </p>
      ) : null}
      {ready && progress.data && asOf ? (
        <div className="card own-checklist-card">
          <Checklist
            progress={progress.data}
            relation="self"
            asOf={asOf}
            booked={booking.data ? ownBooking !== null : null}
            orientation={
              booking.data ? (
                <OrientationLine
                  who="self"
                  booking={ownBooking}
                  asOf={asOf}
                  taskDue={progress.data.tasks.find((t) => t.category === "orientation")?.dueDate ?? null}
                  bookHref="/requests/orientation"
                />
              ) : null
            }
            headingLevel={3}
            bookHref="/requests/orientation"
          />
        </div>
      ) : ready && progress.data ? (
        <>
          {booking.data ? (
            <div className="banner banner-info" data-testid="own-orientation">
              {ownBooking ? (
                <span>
                  <OwnBooking booking={ownBooking} />
                </span>
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
          <div className="card">
            <OnboardingChecklist progress={progress.data} />
          </div>
        </>
      ) : null}
    </section>
  );
}

/**
 * Managers see their direct reports in onboarding; HR sees everyone with a plan (GET /api/team/onboarding).
 * Tiles count people and filter the list; "Where onboarding is stuck" lists the checklist steps with
 * blocked or overdue tasks, and a step filters the list to its people; each row has the person's task
 * bar against due dates. The filter, the step, the sort and the selected person live in the URL
 * (?show=, ?step=, ?sort=, ?person=), written with replace, so a reload, Back and links from Home keep
 * them; invalid values are ignored. A step and a tile filter replace each other.
 */
function TeamOnboarding() {
  const me = useMe();
  const overview = useAsync(() => api.teamOnboarding(), []);
  // The previous rows stay on screen while Try again reloads them.
  const lastData = useRef<OnboardingOverview | null>(null);
  if (overview.data) lastData.current = overview.data;
  const data = overview.data ?? lastData.current;
  const people = data?.people ?? [];
  const asOf = data?.asOf ?? "";

  const [params, setParams] = useSearchParams();
  const rawShow = params.get("show") ?? "";
  const show: ShowFilter = (SHOW_FILTERS as readonly string[]).includes(rawShow) ? (rawShow as ShowFilter) : "all";
  const rawSort = params.get("sort") ?? "";
  const sort: SortOrder = rawSort === "name" || rawSort === "start" ? rawSort : "attention";
  const personParam = params.get("person");
  const stepParam = params.get("step");
  const step = (data?.steps ?? []).find((x) => String(x.stepKey) === stepParam) ?? null;
  const update = (changes: Record<string, string | null>) =>
    setParams(
      (p) => {
        const out = new URLSearchParams(p);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null) out.delete(k);
          else out.set(k, v);
        }
        return out;
      },
      { replace: true },
    );

  const counts = {
    all: people.length,
    unbooked: people.filter((p) => matchesShow(p, "unbooked")).length,
    blocked: people.filter((p) => matchesShow(p, "blocked")).length,
    overdue: people.filter((p) => matchesShow(p, "overdue")).length,
  };
  const shown = sortPeople(
    people.filter((p) => (step ? step.employeeIds.includes(p.employeeId) : matchesShow(p, show))),
    sort,
  );
  const current = shown.find((m) => m.employeeId === personParam) ?? shown[0] ?? null;

  const checklistHeading = useRef<HTMLHeadingElement>(null);
  const allTile = useRef<HTMLButtonElement>(null);
  const focusChecklist = useRef(false);
  const [selections, setSelections] = useState(0);
  const progress = useAsync(() => (current ? api.onboardingFor(current.employeeId) : Promise.resolve(null)), [current?.employeeId]);
  // useAsync keeps the previous result while the next one loads; never show it under another name.
  const checklist = progress.data && !progress.loading && current && progress.data.employeeId === current.employeeId ? progress.data : null;

  function select(m: OnboardingOverviewPerson) {
    update({ person: m.employeeId });
    // On a narrow screen the checklist sits below the whole list, out of view: focus moves to its
    // heading (which scrolls it into view), so a keyboard user reads on from there instead of being
    // sent back up the list by the next Tab. Wide screens show it beside the list; focus stays put.
    focusChecklist.current = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 800px)").matches;
    setSelections((n) => n + 1);
  }
  // After the selection renders, so the heading already names the person. The checklist is scrolled
  // to the top of the screen, and again once it has loaded, when the page may have grown enough to.
  const alignOnLoad = useRef(false);
  const alignChecklist = () => checklistHeading.current?.closest(".onboarding-checklist")?.scrollIntoView?.({ block: "start" });
  useEffect(() => {
    if (!focusChecklist.current) return;
    focusChecklist.current = false;
    checklistHeading.current?.focus({ preventScroll: true });
    alignChecklist();
    alignOnLoad.current = !checklist;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selections]);
  useEffect(() => {
    if (!alignOnLoad.current || (!checklist && !progress.error)) return;
    alignOnLoad.current = false;
    if (document.activeElement === checklistHeading.current) alignChecklist();
  }, [checklist, progress.error]);

  // Show everyone removes the message and its button, so focus goes to the In onboarding tile.
  const showEveryone = () => {
    update({ show: null, step: null });
    allTile.current?.focus();
  };
  // A step filters the list to its people, and focus moves to the line that says so.
  const stepLine = useRef<HTMLParagraphElement>(null);
  const focusStepLine = useRef(false);
  const showStep = (s: OnboardingOverviewStep) => {
    focusStepLine.current = true;
    update({ step: String(s.stepKey), show: null });
  };
  useEffect(() => {
    if (!focusStepLine.current || !step) return;
    focusStepLine.current = false;
    stepLine.current?.focus();
  }, [step]);

  const tiles: Tile[] = [
    { key: "all", count: counts.all, label: "in onboarding", icon: "people" },
    { key: "unbooked", count: counts.unbooked, label: "not booked", icon: "calendar" },
    { key: "blocked", count: counts.blocked, label: "with blocked tasks", icon: "blocked" },
    { key: "overdue", count: counts.overdue, label: "with overdue tasks", icon: "clock" },
  ];

  return (
    <section aria-labelledby="team-onboarding">
      <h2 id="team-onboarding" style={{ fontSize: 17 }}>
        {me.role === "hr_admin" ? "Everyone in onboarding" : "Your direct reports in onboarding"}
      </h2>
      {overview.error ? <ErrorBanner error={overview.error} onRetry={overview.reload} /> : null}
      {!data && !overview.error ? (
        <p className="thinking" role="status">
          Loading the people you support...
        </p>
      ) : null}
      {data && people.length === 0 ? <EmptyState title="No one you support is in onboarding" /> : null}
      {people.length > 0 ? (
        <>
          <StatTiles
            mode="filter"
            label="Show"
            tiles={tiles}
            selected={step ? "" : show}
            onSelect={(key) => update({ show: key === "all" ? null : key, step: null })}
            buttonRefs={{ all: allTile }}
          />
          <StuckSteps steps={data?.steps ?? []} viewer={me.role === "hr_admin" ? "hr_admin" : "manager"} selectedKey={step?.stepKey ?? null} onShow={showStep} />
          {step ? (
            <div className="banner banner-info step-filter" data-testid="step-filter">
              <p className="step-filter-text" tabIndex={-1} ref={stepLine} style={{ margin: 0 }}>
                Showing {step.employeeIds.length === 1 ? "1 person" : `${step.employeeIds.length} people`} stuck on {step.title}
              </p>
              <button type="button" className="btn" onClick={showEveryone}>
                Show everyone
              </button>
            </div>
          ) : null}
          {shown.length === 0 ? (
            <div className="banner" data-testid="filter-empty">
              <span>{step || show === "all" ? "No one is stuck on this step." : EMPTY_FILTER_TEXT[show]}</span>
              <button type="button" className="btn" onClick={showEveryone}>
                Show everyone
              </button>
            </div>
          ) : (
            /* The list comes first in the DOM, as on screen (beside the checklist, or above it on a phone). */
            <div className="onboarding-grid">
              <div className="card onboarding-people-card">
                <div className="people-toolbar">
                  <TaskBarLegend />
                  <div className="field people-sort">
                    <label htmlFor="team-sort">Sort</label>
                    <select id="team-sort" value={sort} onChange={(e) => update({ sort: e.target.value === "attention" ? null : e.target.value })}>
                      {SORTS.map((o) => (
                        <option key={o} value={o}>
                          {SORT_LABEL[o]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <ul className="policy-list onboarding-people" aria-label="People in onboarding">
                  {shown.map((m) => (
                    <li key={m.employeeId} className="person-row" data-testid={`person-${m.employeeId}`}>
                      <div className="person-head">
                        <button
                          type="button"
                          className={`person-name${m.employeeId === current?.employeeId ? " active" : ""}`}
                          aria-pressed={m.employeeId === current?.employeeId}
                          onClick={() => select(m)}
                        >
                          {m.fullName}
                        </button>
                        {m.orientation ? (
                          <span className="status-pill done">Orientation {formatShortDate(m.orientation.startsAt)}</span>
                        ) : (
                          <span className="status-pill open">Not booked</span>
                        )}
                      </div>
                      <TaskBar counts={{ total: m.tasks.total, done: m.tasks.done, overdue: m.tasks.overdue }} text={personLine(m, asOf)} />
                      {m.orientation ? null : (
                        <Link className="person-book" to={bookUrl(m.employeeId)} aria-label={`Book orientation for ${m.fullName}`}>
                          Book orientation
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="card onboarding-checklist">
                <h3 className="onboarding-checklist-title" tabIndex={-1} ref={checklistHeading}>
                  {current ? `${current.fullName}'s checklist` : "Checklist"}
                </h3>
                {progress.error ? (
                  <ErrorBanner error={progress.error} onRetry={progress.reload} />
                ) : checklist && current ? (
                  <div data-testid={`checklist-${checklist.employeeId}`}>
                    <Checklist
                      progress={checklist}
                      relation={me.directReportIds.includes(current.employeeId) ? "manager" : "hr"}
                      asOf={asOf}
                      booked={current.orientation !== null}
                      orientation={
                        <OrientationLine
                          who="report"
                          fullName={current.fullName}
                          booking={current.orientation}
                          asOf={asOf}
                          taskDue={current.orientationTaskDue}
                          bookHref={bookUrl(current.employeeId)}
                        />
                      }
                      headingLevel={4}
                      bookHref={bookUrl(current.employeeId)}
                      bookLabel={`Book orientation for ${current.fullName}`}
                    />
                  </div>
                ) : current ? (
                  <p className="thinking" role="status">
                    Loading {current.fullName}'s checklist...
                  </p>
                ) : null}
              </div>
            </div>
          )}
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
      {/* Booking links appear where someone still needs a session: beside your own checklist, and on
          each unbooked person in the team list. */}
      <p className="page-subtitle">Checklists and progress.</p>
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
