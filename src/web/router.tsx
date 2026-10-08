import { createBrowserRouter } from "react-router";
import type { RouteObject } from "react-router";
import { AppShell } from "./components/AppShell.tsx";
import { ActionsPage } from "./pages/ActionsPage.tsx";
import { ChatPage } from "./pages/ChatPage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { NewTicketPage } from "./pages/NewTicketPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { OnboardingPage } from "./pages/OnboardingPage.tsx";
import { PoliciesPage } from "./pages/PoliciesPage.tsx";
import { PolicyDocumentPage } from "./pages/PolicyDocumentPage.tsx";
import { ScheduleOrientationPage } from "./pages/ScheduleOrientationPage.tsx";
import { TicketsPage } from "./pages/TicketsPage.tsx";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "chat", element: <ChatPage /> },
      { path: "chat/:conversationId", element: <ChatPage /> },
      { path: "policies", element: <PoliciesPage /> },
      { path: "policies/:docId", element: <PolicyDocumentPage /> },
      { path: "policies/:docId/v/:version", element: <PolicyDocumentPage /> },
      { path: "requests/ticket", element: <NewTicketPage /> },
      { path: "requests/orientation", element: <ScheduleOrientationPage /> },
      { path: "tickets", element: <TicketsPage /> },
      { path: "onboarding", element: <OnboardingPage /> },
      { path: "actions", element: <ActionsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createRouter() {
  return createBrowserRouter(routes);
}
