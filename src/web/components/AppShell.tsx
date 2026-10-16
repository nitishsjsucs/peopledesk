import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { api, ApiClientError, onUnauthenticated } from "../lib/api.ts";
import { MeContext } from "../lib/session.tsx";
import { applyTheme, nextTheme, readTheme } from "../lib/theme.ts";
import type { ThemeChoice } from "../lib/theme.ts";
import { useAsync } from "../lib/use-async.ts";
import { EmptyState } from "./EmptyState.tsx";
import { ErrorBanner, SESSION_ENDED } from "./ErrorBanner.tsx";
import { UserBadge } from "./UserBadge.tsx";

const THEME_LABEL: Record<ThemeChoice, string> = { system: "Theme: system", dark: "Theme: dark", light: "Theme: light" };

const NAV: Array<[string, string]> = [
  ["/chat", "Chat"],
  ["/policies", "Policies"],
  ["/requests/ticket", "New ticket"],
  ["/requests/orientation", "Orientation"],
  ["/tickets", "My tickets"],
  ["/onboarding", "Onboarding"],
  ["/actions", "Requests"],
];

const loginUrl = (next: string) => `/dev/login?next=${encodeURIComponent(next)}`;

export function AppShell() {
  const location = useLocation();
  const next = `${location.pathname}${location.search}`;
  const me = useAsync(() => api.me(), []);
  const signedIn = Boolean(me.data);
  // The auth mode decides the badge's way out (switch persona locally, sign out in production).
  const health = useAsync(() => (signedIn ? api.health() : Promise.resolve(null)), [signedIn]);
  const authMode = health.data?.authMode ?? null;
  const [sessionEnded, setSessionEnded] = useState(false);
  useEffect(() => (signedIn ? onUnauthenticated(() => setSessionEnded(true)) : undefined), [signedIn]);
  const [theme, setTheme] = useState<ThemeChoice>(() => readTheme());
  useEffect(() => applyTheme(theme), [theme]);

  const status = me.error instanceof ApiClientError ? me.error.status : null;
  const signedOut = status === 401;
  const unlinked = status === 403;
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          People<span>Desk</span>
        </a>
        {signedOut || unlinked ? null : (
          <nav className="nav" aria-label="Main">
            {NAV.map(([to, label]) => (
              <NavLink key={to} to={to}>
                {label}
              </NavLink>
            ))}
          </nav>
        )}
        <button type="button" className="btn theme-toggle" onClick={() => setTheme(nextTheme(theme))} aria-label={`${THEME_LABEL[theme]}. Change theme`}>
          {THEME_LABEL[theme]}
        </button>
        {me.data ? <UserBadge me={me.data} authMode={authMode} next={next} /> : null}
      </header>
      <main className="content">
        {sessionEnded ? (
          <div className="banner banner-error" role="alert" data-testid="session-ended">
            <span>{SESSION_ENDED}</span>
            <span className="banner-actions">
              <button type="button" className="btn btn-danger" onClick={() => window.location.reload()}>
                Reload
              </button>
              {authMode === "dev" ? (
                <a className="btn" href={loginUrl(next)}>
                  Pick a persona
                </a>
              ) : null}
            </span>
          </div>
        ) : null}
        {me.loading && !me.data ? (
          <p className="thinking" role="status">
            Loading...
          </p>
        ) : null}
        {signedOut ? (
          <EmptyState title="Sign in to PeopleDesk">
            <p>Your session is missing or has expired.</p>
            <p>
              Locally, pick a persona at <a href={loginUrl(next)}>/dev/login</a>. In production, Cloudflare Access signs you in when
              you reload the page.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </EmptyState>
        ) : unlinked ? (
          <EmptyState title="This identity is not linked to PeopleDesk">
            <p>
              You are signed in, but this identity is not linked to a PeopleDesk employee record. Ask the PeopleDesk administrator to
              link it.
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
