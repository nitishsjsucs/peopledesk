// The shell: sign-in, session and connection problems say what to do next, and the badge offers the
// way out for the auth mode (switch persona locally, sign out of Access in production).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { Health } from "../../src/shared/api-types.ts";
import { NETWORK_MESSAGE, setFetch } from "../../src/web/lib/api.ts";
import { routes } from "../../src/web/router.tsx";
import { installFetch, me } from "./fixtures.ts";
import type { Route } from "./fixtures.ts";

const health = (authMode: Health["authMode"]): Health => ({
  ok: true,
  authMode,
  llmProvider: "stub",
  model: "stub-rules-v1",
  retriever: "d1-fts",
  asOf: "2026-10-01",
  version: "1.0.0",
  datasetSha256: null,
});

const signedIn = (authMode: Health["authMode"] = "dev"): Route[] => [
  { path: "/api/me", body: me },
  { path: "/api/health", body: health(authMode) },
];

function renderAt(url: string) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<RouterProvider router={router} />);
  return router;
}

const unauthenticated = { error: { code: "unauthenticated", message: "Authentication required.", requestId: "r" } };

describe("AppShell errors", () => {
  it("says the network is unreachable when fetch rejects, with Try again", async () => {
    let calls = 0;
    setFetch(async () => {
      calls++;
      throw new TypeError("Failed to fetch");
    });
    renderAt("/tickets");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(NETWORK_MESSAGE);
    expect(alert.textContent).not.toContain("Failed to fetch");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls).toBe(2));
  });

  it("says PeopleDesk is temporarily unavailable when a 502 comes back as HTML", async () => {
    setFetch(async () => new Response("<html><body>Bad gateway</body></html>", { status: 502, headers: { "content-type": "text/html" } }));
    renderAt("/");
    expect((await screen.findByRole("alert")).textContent).toContain("PeopleDesk is temporarily unavailable (status 502). Try again in a moment.");
  });

  it("shows one persistent session-ended banner with Reload when a request answers 401 mid-session", async () => {
    installFetch([...signedIn("dev"), { path: "/api/tickets", status: 401, body: unauthenticated }]);
    renderAt("/tickets");
    const banner = await screen.findByTestId("session-ended");
    expect(banner.textContent).toContain("Your session has ended. Reload the page to sign in again.");
    expect(within(banner).getByRole("button", { name: "Reload" })).toBeTruthy();
    await waitFor(() => expect(within(banner).getByRole("link", { name: "Pick a persona" }).getAttribute("href")).toBe("/dev/login?next=%2Ftickets"));
    // No Try again for a 401 anywhere: trying again cannot help.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Reload" }).length).toBeGreaterThanOrEqual(1);
  });

  it("tells an unlinked identity to ask an administrator, without reload advice or navigation", async () => {
    installFetch([{ path: "/api/me", status: 403, body: { error: { code: "forbidden", message: "No employee record for this identity.", requestId: "r" } } }]);
    renderAt("/");
    await screen.findByText(
      "You are signed in, but this identity is not linked to a PeopleDesk employee record. Ask the PeopleDesk administrator to link it.",
    );
    expect(screen.getByRole("main").textContent).not.toMatch(/reload/i);
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
  });

  it("asks a signed-out visitor to sign in, linking back to the page they wanted", async () => {
    installFetch([{ path: "/api/me", status: 401, body: unauthenticated }]);
    renderAt("/policies/POL-001");
    await screen.findByText("Sign in to PeopleDesk");
    expect(screen.getByRole("link", { name: "/dev/login" }).getAttribute("href")).toBe("/dev/login?next=%2Fpolicies%2FPOL-001");
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    expect(screen.queryByTestId("session-ended")).toBeNull();
  });
});

describe("UserBadge", () => {
  it("offers Switch persona in dev mode, back to the current page", async () => {
    installFetch([...signedIn("dev"), { path: "/api/tickets", body: { tickets: [] } }]);
    renderAt("/tickets?status=open");
    const link = await screen.findByRole("link", { name: "Switch persona" });
    expect(link.getAttribute("href")).toBe("/dev/login?next=%2Ftickets%3Fstatus%3Dopen");
    expect(screen.queryByRole("link", { name: "Sign out" })).toBeNull();
  });

  it("offers Sign out in access mode", async () => {
    installFetch([...signedIn("access"), { path: "/api/tickets", body: { tickets: [] } }]);
    renderAt("/tickets");
    expect((await screen.findByRole("link", { name: "Sign out" })).getAttribute("href")).toBe("/cdn-cgi/access/logout");
    expect(screen.queryByRole("link", { name: "Switch persona" })).toBeNull();
  });
});

describe("AppShell navigation and structure", () => {
  const pages: Route[] = [
    ...signedIn("dev"),
    { path: "/api/actions?status=awaiting_approval", body: { actions: [] } },
    { path: "/api/tickets", body: { tickets: [] } },
    { path: "/api/conversations", body: { conversations: [] } },
    { path: "/api/conversations/c1", body: { id: "c1", title: "t", messages: [] } },
  ];

  it("starts with a skip link that moves focus to the main content", async () => {
    installFetch(pages);
    renderAt("/tickets");
    await screen.findByRole("heading", { level: 1, name: "My tickets" });
    const focusable = document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
    expect(focusable[0]?.textContent).toBe("Skip to content");
    fireEvent.click(screen.getByRole("link", { name: "Skip to content" }));
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("titles each page and moves focus to the new page's h1 after a nav link", async () => {
    installFetch(pages);
    renderAt("/");
    await screen.findByRole("heading", { level: 1, name: /Hello, Emeka/ });
    expect(document.title).toBe("PeopleDesk");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "My tickets" }));
    const h1 = await screen.findByRole("heading", { level: 1, name: "My tickets" });
    expect(document.title).toBe("My tickets | PeopleDesk");
    await waitFor(() => expect(document.activeElement).toBe(h1));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Requests" }));
    await screen.findByRole("heading", { level: 1, name: "My requests" });
    expect(document.title).toBe("My requests | PeopleDesk");
  });

  it("does not take focus from the composer when moving from /chat to a conversation", async () => {
    installFetch(pages);
    const router = renderAt("/chat");
    const input = (await screen.findByLabelText("Message")) as HTMLTextAreaElement;
    input.focus();
    await router.navigate("/chat/c1");
    await waitFor(() => expect(document.title).toBe("Chat | PeopleDesk"));
    await waitFor(() => expect((screen.getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(false));
    expect(document.activeElement).not.toBe(screen.getByRole("heading", { level: 1, name: "Chat" }));
    expect(document.activeElement).not.toBe(screen.getByRole("main"));
  });

  it("navigates home through the router when the brand is clicked", async () => {
    installFetch(pages);
    const router = renderAt("/tickets");
    await screen.findByRole("heading", { level: 1, name: "My tickets" });
    const brand = screen.getByRole("link", { name: "PeopleDesk home" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    brand.dispatchEvent(event);
    // A router Link prevents the browser's full page load and moves the router instead.
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("has exactly one h1 on the chat page and on the not-found page", async () => {
    installFetch(pages);
    renderAt("/chat");
    await screen.findByLabelText("Message");
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Chat"]);
    cleanup();
    installFetch(pages);
    renderAt("/no-such-page");
    await screen.findByText("Page not found");
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Page not found"]);
    expect(document.title).toBe("Page not found | PeopleDesk");
  });
});
