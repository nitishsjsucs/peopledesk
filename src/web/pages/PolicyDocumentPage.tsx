import { Link, useParams } from "react-router";
import { EffectiveDateBadge } from "../components/EffectiveDateBadge.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { VersionTimeline } from "../components/VersionTimeline.tsx";
import { api, ApiClientError } from "../lib/api.ts";
import { formatDate } from "../lib/format.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useAsync } from "../lib/use-async.ts";

export function PolicyDocumentPage() {
  const { docId = "", version } = useParams();
  const doc = useAsync(() => api.policy(docId), [docId]);
  const current = doc.data?.versions.find((v) => v.status === "current")?.version;
  const selected = version ? Number(version) : current;
  const body = useAsync(
    () => (selected ? api.policyVersion(docId, selected) : Promise.resolve(null)),
    [docId, selected],
  );

  if (doc.error instanceof ApiClientError && doc.error.status === 404) {
    return (
      <EmptyState title="Policy not found">
        <Link to="/policies">Back to policies</Link>
      </EmptyState>
    );
  }
  if (doc.error) return <ErrorBanner error={doc.error} onRetry={doc.reload} />;
  if (!doc.data) return <p className="thinking">Loading...</p>;
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
              ) : null}
              <div className="message-meta">
                {meta.docId} v{meta.version} · <EffectiveDateBadge effectiveFrom={meta.effectiveFrom} effectiveTo={meta.effectiveTo} status={meta.status} />
              </div>
              <Markdown source={body.data?.markdown ?? ""} />
            </>
          ) : body.error ? (
            <ErrorBanner error={body.error} onRetry={body.reload} />
          ) : (
            <p className="thinking">Loading...</p>
          )}
        </article>
        <aside className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>{doc.data.title}</h2>
          <VersionTimeline docId={docId} versions={doc.data.versions} selected={selected ?? 0} />
        </aside>
      </div>
    </>
  );
}
