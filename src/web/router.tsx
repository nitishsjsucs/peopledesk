import { createBrowserRouter, Navigate } from "react-router";
import type { RouteObject } from "react-router";
import { AppShell } from "./components/AppShell.tsx";
import { ChatPage } from "./pages/ChatPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      // P0: "/" redirects to /chat (HomePage is P1).
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: "chat", element: <ChatPage /> },
      { path: "chat/:conversationId", element: <ChatPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createRouter() {
  return createBrowserRouter(routes);
}
