import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { OnboardingChecklist } from "../components/ToolResultCard.tsx";
import { api, ApiClientError } from "../lib/api.ts";
import { useAsync } from "../lib/use-async.ts";

/** Own checklist (the manager view of direct reports is P1). */
export function OnboardingPage() {
  const progress = useAsync(() => api.onboarding(), []);
  const noPlan = progress.error instanceof ApiClientError && progress.error.status === 404;
  return (
    <>
      <h1 className="page-title">My onboarding</h1>
      <p className="page-subtitle">
        Your checklist and progress. <Link to="/requests/orientation">Book orientation</Link>
      </p>
      {noPlan ? <EmptyState title="You don't have an onboarding plan" /> : null}
      {progress.error && !noPlan ? <ErrorBanner error={progress.error} onRetry={progress.reload} /> : null}
      {progress.data ? (
        <div className="card">
          <OnboardingChecklist progress={progress.data} />
        </div>
      ) : null}
    </>
  );
}
