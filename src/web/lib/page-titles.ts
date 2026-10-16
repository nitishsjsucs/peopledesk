// document.title for each route, and which navigations count as a new page (focus moves to its h1).
import { matchPath } from "react-router";

const TITLES: Array<[string, string | ((params: Record<string, string | undefined>) => string)]> = [
  ["/", "PeopleDesk"],
  ["/chat", "Chat"],
  ["/chat/:conversationId", "Chat"],
  ["/policies", "Policies"],
  ["/policies/:docId", (p) => `${p["docId"] ?? "Policy"}`],
  ["/policies/:docId/v/:version", (p) => `${p["docId"] ?? "Policy"} version ${p["version"] ?? ""}`.trim()],
  ["/requests/ticket", "New ticket"],
  ["/requests/orientation", "Book orientation"],
  ["/tickets", "My tickets"],
  ["/onboarding", "Onboarding"],
  ["/actions", "My requests"],
];

/** "My requests | PeopleDesk"; Home is just "PeopleDesk". */
export function titleFor(pathname: string): string {
  for (const [pattern, title] of TITLES) {
    const m = matchPath(pattern, pathname);
    if (!m) continue;
    const t = typeof title === "function" ? title(m.params) : title;
    return pattern === "/" ? t : `${t} | PeopleDesk`;
  }
  return "Page not found | PeopleDesk";
}

/**
 * Two locations are the same page when only the search changes, when moving between /chat and a
 * conversation, or between versions of one policy. Anything else is a new page.
 */
export function pageKeyOf(pathname: string): string {
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return "/chat";
  const policy = matchPath("/policies/:docId/*", pathname);
  if (policy) return `/policies/${policy.params["docId"] ?? ""}`;
  return pathname.replace(/\/+$/, "") || "/";
}
