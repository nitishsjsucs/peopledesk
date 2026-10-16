import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState.tsx";

export function NotFoundPage() {
  return (
    <EmptyState title="Page not found" level={1}>
      <p className="request-links" style={{ justifyContent: "center" }}>
        <Link to="/">Home</Link>
        <Link to="/chat">Chat</Link>
      </p>
    </EmptyState>
  );
}
