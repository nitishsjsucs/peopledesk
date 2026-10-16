import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { api, ApiClientError, onUnauthenticated } from "../lib/api.ts";
import { BusinessDateContext } from "../lib/business-date.tsx";
import { pageKeyOf, titleFor } from "../lib/page-titles.ts";
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
  // The same answer gives the pages the business date. It is settled once /api/health has answered
  // or failed; a null result means the request has not been made for this sign-in yet.
  const healthAsOf = health.data?.asOf ?? null;
  const healthFailed = Boolean(health.error);
  const businessDate = useMemo(() => ({ asOf: healthAsOf, settled: healthAsOf !== null || healthFailed }), [healthAsOf, healthFailed]);
  const [sessionEnded, setSessionEnded] = useState(false);
  useEffect(() => (signedIn ? onUnauthenticated(() => setSessionEnded(true)) : undefined), [signedIn]);
  const [theme, setTheme] = useState<ThemeChoice>(() => readTheme());
  useEffect(() => applyTheme(theme), [theme]);

  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    document.title = titleFor(location.pathname);
  }, [location.pathname]);
  // On a client navigation to another page, focus moves to the new page's h1 (or to main), so a
  // keyboard or screen reader user starts at the top of what changed. Search-only changes, moving
  // between /chat and a conversation, and the first render keep focus where it is.
  const pageKey = pageKeyOf(location.pathname);
  const previousPage = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousPage.current;
    previousPage.current = pageKey;
    if (previous === null || previous === pageKey) return;
    const main = mainRef.current;
    const h1 = main?.querySelector("h1");
    if (h1) {
      if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
      h1.focus();
    } else main?.focus();
  }, [pageKey]);
  const skipToContent = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    mainRef.current?.focus();
  };

  const status = me.error instanceof ApiClientError ? me.error.status : null;
  const signedOut = status === 401;
  const unlinked = status === 403;
  return (
    <div className="shell">
      <a className="skip-link" href="#main" onClick={skipToContent}>
        Skip to content
      </a>
      <header className="topbar">
        <Link className="brand" to="/" aria-label="PeopleDesk home">
          People<span>Desk</span>
        </Link>
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
      <main className="content" id="main" tabIndex={-1} ref={mainRef}>
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
          <EmptyState title="Sign in to PeopleDesk" level={1}>
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
          <EmptyState title="This identity is not linked to PeopleDesk" level={1}>
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
            <BusinessDateContext.Provider value={businessDate}>
              <Outlet />
            </BusinessDateContext.Provider>
          </MeContext.Provider>
        ) : null}
      </main>
    </div>
  );
}
