import { useState } from "react";
import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { OnboardingChecklist } from "../components/ToolResultCard.tsx";
import { api, ApiClientError } from "../lib/api.ts";
import { useMe } from "../lib/session.tsx";
import { useAsync } from "../lib/use-async.ts";

function OwnChecklist() {
  const progress = useAsync(() => api.onboarding(), []);
  const noPlan = progress.error instanceof ApiClientError && progress.error.status === 404;
  if (noPlan) return null;
  return (
    <section aria-labelledby="own-onboarding">
      <h2 id="own-onboarding" style={{ fontSize: 17 }}>
        My checklist
      </h2>
      {progress.error ? <ErrorBanner error={progress.error} onRetry={progress.reload} /> : null}
      {progress.data ? (
        <div className="card">
          <OnboardingChecklist progress={progress.data} />
        </div>
      ) : null}
    </section>
  );
}

/** Managers see their direct reports in onboarding; HR sees everyone with a plan (the /api/team slice). */
function TeamOnboarding() {
  const team = useAsync(() => api.team(), []);
  const members = (team.data?.members ?? []).filter((m) => m.inOnboarding);
  const [selected, setSelected] = useState<string | null>(null);
  const current = selected ?? members[0]?.employeeId ?? null;
  const progress = useAsync(() => (current ? api.onboardingFor(current) : Promise.resolve(null)), [current]);
  return (
    <section aria-labelledby="team-onboarding">
      <h2 id="team-onboarding" style={{ fontSize: 17 }}>
        People in onboarding
      </h2>
      {team.error ? <ErrorBanner error={team.error} onRetry={team.reload} /> : null}
      {team.data && members.length === 0 ? <EmptyState title="No one you support is in onboarding" /> : null}
      {members.length > 0 ? (
        <div className="policy-grid">
          <div className="card">{progress.data ? <OnboardingChecklist progress={progress.data} /> : <p className="thinking">Loading...</p>}</div>
          <ul className="policy-list card" aria-label="People in onboarding">
            {members.map((m) => (
              <li key={m.employeeId}>
                <button
                  type="button"
                  className={`btn-link${m.employeeId === current ? " active" : ""}`}
                  aria-pressed={m.employeeId === current}
                  onClick={() => setSelected(m.employeeId)}
                  style={{ border: 0, background: "none", cursor: "pointer", padding: 0, font: "inherit", color: "var(--primary)" }}
                >
                  {m.fullName}
                </button>
                <span className={`status-pill ${m.booked ? "done" : "open"}`}>{m.booked ? "orientation booked" : "not booked"}</span>
              </li>
            ))}
          </ul>
        </div>
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
        Checklists and progress. <Link to="/requests/orientation">Book orientation</Link>
      </p>
      <OwnChecklist />
      {me.role === "employee" && !me.inOnboarding ? <EmptyState title="You don't have an onboarding plan" /> : null}
      {me.role !== "employee" ? <TeamOnboarding /> : null}
    </>
  );
}
