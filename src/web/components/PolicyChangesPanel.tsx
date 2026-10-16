// "Policy changes": what took effect in the last 90 days and what is scheduled within a year, among
// the policies the reader can see (GET /api/policy-changes, metadata only). A dated list answers "what
// changed lately, and what changes soon"; each item links to that version.
import { useId, useState } from "react";
import { Link } from "react-router";
import type { PolicyChange } from "../../shared/api-types.ts";
import type { PolicyCategory } from "../../shared/domain.ts";
import { api } from "../lib/api.ts";
import { useBusinessDate } from "../lib/business-date.tsx";
import { relativeDays } from "../lib/dates.ts";
import { formatDate } from "../lib/format.ts";
import { useAsync } from "../lib/use-async.ts";
import { ErrorBanner } from "./ErrorBanner.tsx";

/** Items a group shows before Show all. */
export const CHANGES_SHOWN = 4;

function ChangeItem({ change, asOf }: { change: PolicyChange; asOf: string | null }) {
  return (
    <li className="change-item">
      <div className="change-when">
        {formatDate(change.effectiveFrom)}
        {asOf ? `, ${relativeDays(change.effectiveFrom, asOf)}` : ""}
      </div>
      <div className="change-what">
        <Link to={`/policies/${change.docId}/v/${change.version}`}>{change.title}</Link>{" "}
        <span className="message-meta">{change.version === 1 ? "new policy" : `version ${change.version - 1} to ${change.version}`}</span>
      </div>
      <div className="change-summary">{change.changeSummary}</div>
    </li>
  );
}

function ChangeGroup({ title, changes, asOf, testId }: { title: string; changes: PolicyChange[]; asOf: string | null; testId: string }) {
  const [all, setAll] = useState(false);
  const listId = useId();
  if (changes.length === 0) return null;
  const shown = all ? changes : changes.slice(0, CHANGES_SHOWN);
  return (
    <div className="change-group" data-testid={testId}>
      <h3 className="change-group-title">
        {title} ({changes.length})
      </h3>
      <ul className="change-list" id={listId}>
        {shown.map((c) => (
          <ChangeItem key={`${c.docId}@${c.version}`} change={c} asOf={asOf} />
        ))}
      </ul>
      {changes.length > CHANGES_SHOWN ? (
        <button type="button" className="btn-link change-more" aria-expanded={all} aria-controls={listId} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${changes.length}`}
        </button>
      ) : null}
    </div>
  );
}

export function PolicyChangesPanel({ category, categoryLabel }: { category: PolicyCategory | ""; categoryLabel: string | null }) {
  const { asOf } = useBusinessDate();
  const changes = useAsync(() => api.policyChanges(category ? { category } : {}), [category]);
  const data = changes.data;
  const comingUp = (data?.changes ?? []).filter((c) => c.status === "scheduled");
  // Newest first; changes on the same day keep document order.
  const recent = (data?.changes ?? [])
    .filter((c) => c.status !== "scheduled")
    .sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? 0 : a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return (
    <section className="card policy-changes" aria-labelledby="policy-changes-title" data-testid="policy-changes">
      <h2 id="policy-changes-title" className="policy-changes-title">
        Policy changes
      </h2>
      {changes.error ? <ErrorBanner context="Could not load policy changes." error={changes.error} onRetry={changes.reload} /> : null}
      {changes.loading && !changes.error ? (
        <p className="thinking" role="status">
          Loading policy changes...
        </p>
      ) : null}
      {data && !changes.loading && data.changes.length === 0 ? (
        <p className="message-meta" data-testid="policy-changes-empty">
          No {categoryLabel ? `${categoryLabel} ` : ""}policy changes in the last 90 days or scheduled in the next year.
        </p>
      ) : null}
      {data && !changes.loading ? (
        <div className="change-groups">
          {/* Keyed by category, so Show all closes again when the category changes. */}
          <ChangeGroup key={`up-${category}`} title="Coming up" changes={comingUp} asOf={asOf} testId="changes-coming-up" />
          <ChangeGroup key={`recent-${category}`} title="Took effect in the last 90 days" changes={recent} asOf={asOf} testId="changes-recent" />
        </div>
      ) : null}
      {data?.truncated ? <p className="message-meta">Showing the first 50 changes.</p> : null}
    </section>
  );
}
