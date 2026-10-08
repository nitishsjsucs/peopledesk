import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { Citation, PendingActionView, TranscriptMessage, TurnResult } from "../../shared/api-types.ts";
import { ChatComposer } from "../components/ChatComposer.tsx";
import { ConversationList } from "../components/ConversationList.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBanner, errorMessage } from "../components/ErrorBanner.tsx";
import { MessageList } from "../components/MessageList.tsx";
import type { ChatEntry } from "../components/MessageList.tsx";
import { SourceDrawer } from "../components/SourceDrawer.tsx";
import { api } from "../lib/api.ts";
import { useMe } from "../lib/session.tsx";
import { useAsync } from "../lib/use-async.ts";

let counter = 0;
const key = () => `local-${++counter}`;

function toEntries(messages: TranscriptMessage[]): ChatEntry[] {
  const out: ChatEntry[] = [];
  let lastUser = "";
  for (const m of messages) {
    if (m.role === "user") {
      lastUser = m.text;
      out.push({ key: `m${m.id}`, role: "user", text: m.text });
    } else if (m.role === "assistant" && m.payload) {
      out.push({ key: `m${m.id}`, role: "assistant", result: m.payload as TurnResult, retryText: lastUser });
    } else {
      out.push({ key: `m${m.id}`, role: "system", text: m.text });
    }
  }
  return out;
}

/**
 * The transcript stores each turn as it was. A request proposed in chat may since have been approved,
 * rejected, replaced by an edit or expired (here, on /actions, or by its expiry), so cards that were
 * awaiting approval are shown with the request's current state. Best effort: if the actions cannot be
 * loaded, the stored cards are shown and the server still refuses a stale approval.
 */
async function withCurrentActions(entries: ChatEntry[]): Promise<ChatEntry[]> {
  const stale = entries.some((e) => e.role === "assistant" && e.result.pendingAction?.status === "awaiting_approval");
  if (!stale) return entries;
  let current: Map<string, PendingActionView>;
  try {
    current = new Map((await api.actions()).actions.map((a) => [a.actionId, a]));
  } catch {
    return entries;
  }
  return entries.map((e) => {
    if (e.role !== "assistant" || !e.result.pendingAction) return e;
    const now = current.get(e.result.pendingAction.actionId);
    return now ? { ...e, result: { ...e.result, pendingAction: now } } : e;
  });
}

const SUGGESTIONS = [
  "How fast does paid time off accrue?",
  "What is the maximum annual wellness stipend?",
  "Show my tickets",
  "How is my onboarding progress?",
  "List upcoming orientation sessions",
];

export function ChatPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const conversations = useAsync(() => api.conversations(), []);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [citation, setCitation] = useState<Citation | null>(null);
  const queued = useRef<string | null>(null);

  const sendTo = useCallback(
    async (id: string, text: string) => {
      setSending(true);
      setEntries((e) => [...e, { key: key(), role: "user", text }]);
      try {
        const result = await api.sendMessage(id, text);
        setEntries((e) => [...e, { key: key(), role: "assistant", result, retryText: text }]);
        conversations.reload();
      } catch (err) {
        setEntries((e) => [...e, { key: key(), role: "failure", message: errorMessage(err), retryText: text }]);
      } finally {
        setSending(false);
      }
    },
    [conversations],
  );

  useEffect(() => {
    setLoadError(null);
    if (!conversationId) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    api.conversation(conversationId).then(
      async (c) => {
        // Cards take their decided state from the first render, so the current state is merged first.
        const shown = await withCurrentActions(toEntries(c.messages));
        if (cancelled) return;
        setEntries(shown);
        const q = queued.current;
        queued.current = null;
        if (q) void sendTo(conversationId, q);
      },
      (err: unknown) => {
        if (!cancelled) setLoadError(err);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  async function onSend(text: string) {
    if (conversationId) return sendTo(conversationId, text);
    try {
      const { id } = await api.createConversation();
      queued.current = text;
      navigate(`/chat/${id}`);
    } catch (err) {
      setLoadError(err);
    }
  }

  return (
    <div className="chat-layout">
      <ConversationList conversations={conversations.data?.conversations ?? []} onNew={() => navigate("/chat")} />
      <section className="chat-main" aria-label="Chat">
        {loadError ? <ErrorBanner error={loadError} /> : null}
        {entries.length === 0 && !sending ? (
          <div className="chat-empty">
            <EmptyState title={`Hi ${me.fullName.split(" ")[0]}, how can I help?`}>
              <p>Answers cite the policy version they come from. Actions wait for your approval.</p>
              <div className="citations" style={{ justifyContent: "center" }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="btn" onClick={() => void onSend(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </EmptyState>
          </div>
        ) : (
          <MessageList entries={entries} sending={sending} onOpenCitation={setCitation} onRetry={(t) => void onSend(t)} />
        )}
        <ChatComposer onSend={(t) => void onSend(t)} disabled={sending} />
      </section>
      {citation ? <SourceDrawer citation={citation} onClose={() => setCitation(null)} /> : null}
    </div>
  );
}
