import { useState } from "react";
import { Link } from "react-router";
import { POLICY_CATEGORIES } from "../../shared/domain.ts";
import type { PolicyCategory } from "../../shared/domain.ts";
import { EffectiveDateBadge } from "../components/EffectiveDateBadge.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { api } from "../lib/api.ts";
import { useAsync } from "../lib/use-async.ts";

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

export function PoliciesPage() {
  const [category, setCategory] = useState<PolicyCategory | "">("");
  const [q, setQ] = useState("");
  const list = useAsync(() => api.policies({ ...(category ? { category } : {}), ...(q.trim() ? { q: q.trim() } : {}) }), [category, q]);
  return (
    <>
      <h1 className="page-title">Policies</h1>
      <p className="page-subtitle">The policies you can read, each at the version in effect today.</p>
      <div className="filters">
        <div className="field">
          <label htmlFor="policy-category">Category</label>
          <select id="policy-category" value={category} onChange={(e) => setCategory(e.target.value as PolicyCategory | "")}>
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
          <input id="policy-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="stipend, leave, travel..." />
        </div>
      </div>
      {list.error ? <ErrorBanner error={list.error} onRetry={list.reload} /> : null}
      {list.data && list.data.documents.length === 0 ? <EmptyState title="No policies match" /> : null}
      <ul className="policy-list card">
        {(list.data?.documents ?? []).map((d) => (
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
    </>
  );
}
