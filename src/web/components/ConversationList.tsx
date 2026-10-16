import { useLayoutEffect, useRef } from "react";
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
  const itemsRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const picked = useRef(false);
  // On a narrow screen, picking a conversation folds the list and hides the link that had focus, so
  // focus moves to the toggle, which says the list is folded. It runs before paint, while the browser
  // still has focus on the link. Wide screens never hide the list, so focus stays on the link there.
  useLayoutEffect(() => {
    if (!collapsed || !picked.current) return;
    picked.current = false;
    const items = itemsRef.current;
    if (items && getComputedStyle(items).display === "none") toggleRef.current?.focus();
  }, [collapsed]);
  return (
    <aside className={`conversation-list${collapsed ? " collapsed" : ""}`} aria-label="Conversations">
      <div className="conversation-list-head">
        <button type="button" className="btn btn-primary" onClick={onNew}>
          New conversation
        </button>
        <button
          type="button"
          ref={toggleRef}
          className="btn conversation-toggle"
          aria-expanded={!collapsed}
          aria-controls="conversation-items"
          onClick={onToggle}
        >
          Conversations ({conversations.length})
        </button>
      </div>
      <div id="conversation-items" className="conversation-items" ref={itemsRef}>
        {error ? <ErrorBanner error={error} onRetry={onRetry} /> : null}
        {loading && conversations.length === 0 && !error ? (
          <p className="thinking" role="status">
            Loading conversations...
          </p>
        ) : null}
        {!loading && !error && conversations.length === 0 ? <p className="message-meta conversation-empty">No conversations yet.</p> : null}
        <ul>
          {conversations.map((c) => (
            <li key={c.id}>
              <NavLink
                to={`/chat/${c.id}`}
                title={c.title}
                onClick={() => {
                  picked.current = true;
                }}
              >
                {c.title}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
