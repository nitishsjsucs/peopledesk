import { Link, useSearchParams } from "react-router";
import { POLICY_CATEGORIES } from "../../shared/domain.ts";
import type { PolicyCategory } from "../../shared/domain.ts";
import { EffectiveDateBadge } from "../components/EffectiveDateBadge.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { api } from "../lib/api.ts";
import { useAsync } from "../lib/use-async.ts";
import { useDebounced } from "../lib/use-debounced.ts";

export const CATEGORY_LABEL: Record<PolicyCategory, string> = {
  time_off: "Time off",
  benefits: "Benefits",
  compensation: "Compensation",
  travel_expense: "Travel and expenses",
  remote_work: "Remote work",
  it_security: "IT security",
  conduct: "Conduct",
  onboarding_learning: "Onboarding and learning",
  health_safety: "Health and safety",
  performance: "Performance",
};

/** How long typing must pause before the list is asked for again. */
export const SEARCH_DEBOUNCE_MS = 300;

/** The readable policies. The filters live in ?q= and ?category=, so Back from a document keeps them. */
export function PoliciesPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const rawCategory = params.get("category") ?? "";
  const category = (POLICY_CATEGORIES as readonly string[]).includes(rawCategory) ? (rawCategory as PolicyCategory) : "";
  const query = useDebounced(q.trim(), SEARCH_DEBOUNCE_MS);
  const list = useAsync(() => api.policies({ ...(category ? { category } : {}), ...(query ? { q: query } : {}) }), [category, query]);
  const update = (key: "q" | "category", value: string) =>
    setParams(
      (p) => {
        const out = new URLSearchParams(p);
        if (value) out.set(key, value);
        else out.delete(key);
        return out;
      },
      { replace: true },
    );
  const clear = () => setParams(new URLSearchParams(), { replace: true });
  const documents = list.data?.documents ?? [];
  return (
    <>
      <h1 className="page-title">Policies</h1>
      <p className="page-subtitle">The policies you can read, each at the version in effect today.</p>
      <div className="filters">
        <div className="field">
          <label htmlFor="policy-category">Category</label>
          <select id="policy-category" value={category} onChange={(e) => update("category", e.target.value)}>
            <option value="">All categories</option>
            {POLICY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="policy-search">Search titles</label>
          <input id="policy-search" type="search" value={q} onChange={(e) => update("q", e.target.value)} placeholder="stipend, leave, travel..." />
        </div>
      </div>
      {list.error ? <ErrorBanner error={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.error ? (
        <p className="thinking" role="status">
          Loading policies...
        </p>
      ) : null}
      {list.data && !list.loading && documents.length === 0 ? (
        <EmptyState title="No policies match">
          <p>Try other words, or ask in chat: answers search the policy text, not only titles.</p>
          <p className="request-links" style={{ justifyContent: "center" }}>
            <button type="button" className="btn" onClick={clear}>
              Clear filters
            </button>
            <Link to="/chat">Ask in chat</Link>
          </p>
        </EmptyState>
      ) : null}
      {documents.length > 0 ? (
        <ul className="policy-list card" data-testid="policy-list">
          {documents.map((d) => (
            <li key={d.docId}>
              <div>
                <Link to={`/policies/${d.docId}`}>{d.title}</Link>
                <div className="message-meta">
                  {d.docId} v{d.currentVersion} · {CATEGORY_LABEL[d.category]}
                  {d.audience !== "all" ? ` · ${d.audience === "managers" ? "managers" : "HR"} only` : ""}
                </div>
              </div>
              <EffectiveDateBadge effectiveFrom={d.effectiveFrom} effectiveTo={null} status="current" />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
