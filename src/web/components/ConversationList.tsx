import { NavLink } from "react-router";
import { ErrorBanner } from "./ErrorBanner.tsx";

type Props = {
  conversations: Array<{ id: string; title: string; updatedAt: string }>;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onNew: () => void;
  /** Below 800px the list folds away behind a toggle; wider screens always show it. */
  collapsed: boolean;
  onToggle: () => void;
};

export function ConversationList({ conversations, loading, error, onRetry, onNew, collapsed, onToggle }: Props) {
  return (
    <aside className={`conversation-list${collapsed ? " collapsed" : ""}`} aria-label="Conversations">
      <div className="conversation-list-head">
        <button type="button" className="btn btn-primary" onClick={onNew}>
          New conversation
        </button>
        <button
          type="button"
          className="btn conversation-toggle"
          aria-expanded={!collapsed}
          aria-controls="conversation-items"
          onClick={onToggle}
        >
          Conversations ({conversations.length})
        </button>
      </div>
      <div id="conversation-items" className="conversation-items">
        {error ? <ErrorBanner error={error} onRetry={onRetry} /> : null}
        {loading && conversations.length === 0 && !error ? (
          <p className="thinking" role="status">
            Loading conversations...
          </p>
        ) : null}
        <ul>
          {conversations.map((c) => (
            <li key={c.id}>
              <NavLink to={`/chat/${c.id}`} title={c.title}>
                {c.title}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
