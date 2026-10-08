import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState.tsx";

export function NotFoundPage() {
  return (
    <EmptyState title="Page not found">
      <Link to="/chat">Back to chat</Link>
    </EmptyState>
  );
}
