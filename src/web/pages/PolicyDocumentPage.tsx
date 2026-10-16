import { Link, useParams } from "react-router";
import { EffectiveDateBadge } from "../components/EffectiveDateBadge.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { VersionTimeline } from "../components/VersionTimeline.tsx";
import { api, ApiClientError } from "../lib/api.ts";
import { useBusinessDate } from "../lib/business-date.tsx";
import { lineChanges } from "../lib/diff.ts";
import { formatDate } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useAsync } from "../lib/use-async.ts";

const VERSION_RE = /^[1-9]\d*$/;
const isNotFound = (e: unknown) => e instanceof ApiClientError && e.status === 404;

export function PolicyDocumentPage() {
  const { docId = "", version } = useParams();
  const { asOf } = useBusinessDate();
  const doc = useAsync(() => api.policy(docId), [docId]);
  const current = doc.data?.versions.find((v) => v.status === "current")?.version;
  const scheduled = doc.data?.versions.find((v) => v.status === "scheduled");
  // /v/abc or /v/0 is no version at all; the body is fetched only for a well-formed number.
  const wellFormed = version === undefined || VERSION_RE.test(version);
  const selected = version === undefined ? current : wellFormed ? Number(version) : undefined;
  const body = useAsync(() => (selected ? api.policyVersion(docId, selected) : Promise.resolve(null)), [docId, selected]);
  const previous = useAsync(
    () => (selected && selected > 1 ? api.policyVersion(docId, selected - 1) : Promise.resolve(null)),
    [docId, selected],
  );
  const changes = body.data && previous.data ? lineChanges(previous.data.markdown, body.data.markdown) : [];

  // A document above the reader's clearance answers 404 like a missing one, so nothing is disclosed.
  if (isNotFound(doc.error)) {
    return (
      <EmptyState title="Policy not found" level={1}>
        <Link to="/policies">Back to policies</Link>
      </EmptyState>
    );
  }
  if (doc.error) return <ErrorBanner error={doc.error} onRetry={doc.reload} />;
  if (!doc.data) {
    return (
      <p className="thinking" role="status">
        Loading...
      </p>
    );
  }
  const missingVersion = !wellFormed || (selected !== undefined && !doc.data.versions.some((v) => v.version === selected)) || isNotFound(body.error);
  if (version !== undefined && missingVersion) {
    return (
      <EmptyState title="Version not found" level={1}>
        <p data-testid="version-missing">
          Version {version} of {docId} does not exist.
        </p>
        {current ? <Link to={`/policies/${docId}/v/${current}`}>See the current version</Link> : <Link to={`/policies/${docId}`}>See the document</Link>}
      </EmptyState>
    );
  }
  const meta = body.data?.meta;
  return (
    <>
      <p>
        <Link to="/policies">All policies</Link>
      </p>
      <div className="policy-grid">
        <article className="card">
          {meta ? (
            <>
              {meta.status !== "current" ? (
                <div className="superseded-note" role="note">
                  {meta.status === "superseded"
                    ? `This version was superseded on ${formatDate(meta.effectiveTo ?? "")}. `
                    : `This version takes effect on ${formatDate(meta.effectiveFrom)}. `}
                  {current ? <Link to={`/policies/${docId}/v/${current}`}>See the current version</Link> : null}
                </div>
              ) : scheduled ? (
                <div className="superseded-note" role="note" data-testid="scheduled-note">
                  <Link to={`/policies/${docId}/v/${scheduled.version}`}>Version {scheduled.version}</Link> takes effect on{" "}
                  {formatDate(scheduled.effectiveFrom)}.
                </div>
              ) : null}
              <div className="message-meta">
                {meta.docId} v{meta.version} · <EffectiveDateBadge effectiveFrom={meta.effectiveFrom} effectiveTo={meta.effectiveTo} status={meta.status} />
              </div>
              {changes.length > 0 ? (
                <details className="diff" open data-testid="version-diff">
                  <summary>Changes from version {(selected ?? 1) - 1}</summary>
                  <ul>
                    {changes.map((c, i) => (
                      <li key={i} className={`diff-${c.kind}`}>
                        <span className="visually-hidden">{c.kind === "added" ? "Added: " : "Removed: "}</span>
                        <span aria-hidden="true">{c.kind === "added" ? "+ " : "- "}</span>
                        {c.text.replace(/^[-*]\s+/, "")}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <Markdown source={body.data?.markdown ?? ""} />
            </>
          ) : body.error ? (
            <ErrorBanner error={body.error} onRetry={body.reload} />
          ) : (
            <p className="thinking" role="status">
              Loading...
            </p>
          )}
        </article>
        <aside className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>{doc.data.title}</h2>
          <VersionTimeline docId={docId} versions={doc.data.versions} selected={selected ?? 0} asOf={asOf} />
        </aside>
      </div>
    </>
  );
}
