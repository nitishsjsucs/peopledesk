import { NavLink } from "react-router";

type Props = {
  conversations: Array<{ id: string; title: string; updatedAt: string }>;
  onNew: () => void;
};

export function ConversationList({ conversations, onNew }: Props) {
  return (
    <aside className="conversation-list" aria-label="Conversations">
      <button type="button" className="btn btn-primary" onClick={onNew}>
        New conversation
      </button>
      <ul>
        {conversations.map((c) => (
          <li key={c.id}>
            <NavLink to={`/chat/${c.id}`} title={c.title}>
              {c.title}
            </NavLink>
          </li>
        ))}
      </ul>
    </aside>
  );
}
