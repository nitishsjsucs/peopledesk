import { NavLink, Outlet } from "react-router";
import { api, ApiClientError } from "../lib/api.ts";
import { MeContext } from "../lib/session.tsx";
import { useAsync } from "../lib/use-async.ts";
import { EmptyState } from "./EmptyState.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { UserBadge } from "./UserBadge.tsx";

const NAV: Array<[string, string]> = [
  ["/chat", "Chat"],
  ["/policies", "Policies"],
  ["/requests/ticket", "New ticket"],
  ["/requests/orientation", "Orientation"],
  ["/tickets", "My tickets"],
  ["/onboarding", "Onboarding"],
  ["/actions", "Requests"],
];

export function AppShell() {
  const me = useAsync(() => api.me(), []);
  const unauthenticated = me.error instanceof ApiClientError && (me.error.status === 401 || me.error.status === 403);
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          People<span>Desk</span>
        </a>
        <nav className="nav" aria-label="Main">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to}>
              {label}
            </NavLink>
          ))}
        </nav>
        {me.data ? <UserBadge me={me.data} /> : null}
      </header>
      <main className="content">
        {me.loading && !me.data ? <p className="thinking">Loading...</p> : null}
        {unauthenticated ? (
          <EmptyState title="Sign in to PeopleDesk">
            <p>Your session is missing or expired.</p>
            <p>
              Locally, pick a persona at <a href="/dev/login">/dev/login</a>. In production, Cloudflare Access signs you in;
              reload the page.
            </p>
          </EmptyState>
        ) : me.error ? (
          <ErrorBanner error={me.error} onRetry={me.reload} />
        ) : null}
        {me.data ? (
          <MeContext.Provider value={me.data}>
            <Outlet />
          </MeContext.Provider>
        ) : null}
      </main>
    </div>
  );
}
