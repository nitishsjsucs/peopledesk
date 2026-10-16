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
import { api, ApiClientError } from "../lib/api.ts";
import { useMe } from "../lib/session.tsx";
import { useAsync } from "../lib/use-async.ts";

let counter = 0;
const key = () => `local-${++counter}`;

/** How often, and how many times, to look for a previous reply after a 409 turn_in_progress (60 s, the turn ceiling). */
export const TURN_POLL_MS = 4000;
export const TURN_POLL_MAX = 15;

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

const retryAfterOf = (err: unknown): number | null => {
  if (!(err instanceof ApiClientError) || err.code !== "rate_limited") return null;
  const s = (err.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
  return typeof s === "number" && s > 0 ? Math.ceil(s) : null;
};

/** Ticks once a second while `active`; one interval, cleared when inactive or unmounted. */
function useSecondTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

type Phase = "ready" | "loading" | "not_found" | "load_error";

export function ChatPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const conversations = useAsync(() => api.conversations(), []);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [phase, setPhase] = useState<Phase>("ready");
  const [loadTick, setLoadTick] = useState(0);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [createError, setCreateError] = useState<unknown>(null);
  const [sendingFor, setSendingFor] = useState<string | null>(null);
  const [sendingSince, setSendingSince] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [listCollapsed, setListCollapsed] = useState(Boolean(conversationId));
  const queued = useRef<{ id: string; text: string } | null>(null);
  const creatingRef = useRef(false);
  const active = useRef<string | null>(conversationId ?? null);
  /** Messages the server's transcript holds for the open conversation, as far as this page knows. */
  const transcriptCount = useRef(0);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sending = sendingFor !== null && sendingFor === conversationId;
  const now = useSecondTicker(sending || cooldownUntil !== null);
  const cooldownLeft = cooldownUntil ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000)) : 0;
  useEffect(() => {
    if (cooldownUntil !== null && cooldownLeft === 0) setCooldownUntil(null);
  }, [cooldownLeft, cooldownUntil]);
  const elapsedSeconds = sending && sendingSince ? Math.floor((now - sendingSince) / 1000) : 0;

  const stopPolling = useCallback(() => {
    if (poll.current) clearTimeout(poll.current);
    poll.current = null;
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  /**
   * After a 409 turn_in_progress: look for the previous reply every 4 s, at most 15 times, then show
   * the transcript with it and keep this message's Retry.
   */
  const waitForPreviousReply = useCallback(
    (id: string, failure: Extract<ChatEntry, { role: "failure" }>) => {
      stopPolling();
      const baseline = transcriptCount.current;
      let count = 0;
      const settle = (message: string) =>
        setEntries((prev) => prev.map((e) => (e.key === failure.key ? { ...failure, message, pending: false } : e)));
      const tick = async () => {
        poll.current = null;
        count++;
        let grown: TranscriptMessage[] | null = null;
        try {
          const c = await api.conversation(id);
          if (c.messages.length > baseline) grown = c.messages;
        } catch {
          // keep waiting; the next look may succeed
        }
        if (active.current !== id) return;
        if (grown) {
          transcriptCount.current = grown.length;
          const shown = await withCurrentActions(toEntries(grown));
          if (active.current !== id) return;
          setEntries([
            ...shown,
            { key: key(), role: "user", text: failure.retryText },
            { ...failure, pending: false, message: "PeopleDesk has finished your previous message, so this one was not sent. Retry to send it." },
          ]);
          return;
        }
        if (count >= TURN_POLL_MAX) {
          settle("PeopleDesk is still answering your previous message. Try again in a moment.");
          return;
        }
        poll.current = setTimeout(() => void tick(), TURN_POLL_MS);
      };
      poll.current = setTimeout(() => void tick(), TURN_POLL_MS);
    },
    [stopPolling],
  );

  const sendTo = useCallback(
    async (id: string, text: string, opts: { bubble?: boolean } = {}) => {
      setSendingFor(id);
      setSendingSince(Date.now());
      if (opts.bubble !== false) setEntries((e) => [...e, { key: key(), role: "user", text }]);
      try {
        const result = await api.sendMessage(id, text);
        if (active.current !== id) return;
        transcriptCount.current += 2;
        setEntries((e) => [...e, { key: key(), role: "assistant", result, retryText: text }]);
        conversations.reload();
      } catch (err) {
        if (active.current !== id) return;
        const wait = retryAfterOf(err);
        if (wait) setCooldownUntil(Date.now() + wait * 1000);
        if (err instanceof ApiClientError && err.code === "turn_in_progress") {
          const failure = { key: key(), role: "failure" as const, message: "Still answering your previous message...", retryText: text, pending: true };
          setEntries((e) => [...e, failure]);
          waitForPreviousReply(id, failure);
        } else {
          setEntries((e) => [...e, { key: key(), role: "failure", message: errorMessage(err), retryText: text }]);
        }
      } finally {
        setSendingFor((s) => (s === id ? null : s));
        setSendingSince(null);
      }
    },
    [conversations, waitForPreviousReply],
  );

  useEffect(() => {
    active.current = conversationId ?? null;
    stopPolling();
    setLoadError(null);
    setCreateError(null);
    setListCollapsed(Boolean(conversationId));
    // The previous conversation's messages never show under this one, and nothing can be sent until
    // its own transcript arrives.
    setEntries([]);
    transcriptCount.current = 0;
    if (!conversationId) {
      setPhase("ready");
      return;
    }
    setPhase("loading");
    let cancelled = false;
    api.conversation(conversationId).then(
      async (c) => {
        // Cards take their decided state from the first render, so the current state is merged first.
        const shown = await withCurrentActions(toEntries(c.messages));
        if (cancelled) return;
        transcriptCount.current = c.messages.length;
        setEntries(shown);
        setPhase("ready");
        const q = queued.current;
        queued.current = null;
        if (q && q.id === conversationId) void sendTo(conversationId, q.text);
      },
      (err: unknown) => {
        if (cancelled) return;
        // The server answers 404 for a malformed id too, and for another person's conversation.
        if (err instanceof ApiClientError && err.status === 404) setPhase("not_found");
        else {
          setLoadError(err);
          setPhase("load_error");
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, loadTick]);

  async function onSend(text: string) {
    if (conversationId && phase !== "not_found") return sendTo(conversationId, text);
    // One conversation per start, however often the button is pressed while it is being created.
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      const { id } = await api.createConversation();
      queued.current = { id, text };
      navigate(`/chat/${id}`);
    } catch (err) {
      const wait = retryAfterOf(err);
      if (wait) setCooldownUntil(Date.now() + wait * 1000);
      setCreateError(err);
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  function onRetry(entry: ChatEntry) {
    if (!conversationId || entry.role === "user" || entry.role === "system") return;
    if (entry.role === "failure") {
      // The message never reached a reply, so it is sent again under its own bubble.
      setEntries((e) => e.filter((x) => x.key !== entry.key));
      void sendTo(conversationId, entry.retryText, { bubble: false });
      return;
    }
    if (entry.retryText) void sendTo(conversationId, entry.retryText);
  }

  const blockedReason = cooldownLeft > 0 ? `You can send again in ${cooldownLeft} s.` : creating ? "Starting a conversation..." : null;
  const composerDisabled = sending || phase === "loading" || phase === "load_error";
  const showSuggestions = phase === "ready" && entries.length === 0 && !sending;

  return (
    <div className="chat-layout">
      <ConversationList
        conversations={conversations.data?.conversations ?? []}
        loading={conversations.loading}
        error={conversations.error}
        onRetry={conversations.reload}
        onNew={() => navigate("/chat")}
        collapsed={listCollapsed}
        onToggle={() => setListCollapsed((c) => !c)}
      />
      <section className="chat-main" aria-label="Chat">
        {createError ? <ErrorBanner error={createError} /> : null}
        {phase === "load_error" ? <ErrorBanner error={loadError} onRetry={() => setLoadTick((t) => t + 1)} /> : null}
        {phase === "loading" ? (
          <p className="thinking chat-status" role="status">
            Loading conversation...
          </p>
        ) : phase === "not_found" ? (
          <div className="chat-empty">
            <EmptyState title="This conversation was not found">
              <p>It may belong to another account, or the link may be incomplete. Anything you send here starts a new conversation.</p>
              <button type="button" className="btn btn-primary" onClick={() => navigate("/chat")}>
                Start a new conversation
              </button>
            </EmptyState>
          </div>
        ) : showSuggestions ? (
          <div className="chat-empty">
            <EmptyState title={`Hi ${me.fullName.split(" ")[0]}, how can I help?`}>
              <p>Answers cite the policy version they come from. Actions wait for your approval.</p>
              <div className="citations" style={{ justifyContent: "center" }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="btn" onClick={() => void onSend(s)} disabled={creating || cooldownLeft > 0}>
                    {s}
                  </button>
                ))}
              </div>
            </EmptyState>
          </div>
        ) : phase === "ready" ? (
          <MessageList
            entries={entries}
            sending={sending}
            elapsedSeconds={elapsedSeconds}
            onOpenCitation={setCitation}
            onRetry={onRetry}
            retryDisabled={sending || cooldownLeft > 0}
          />
        ) : null}
        <ChatComposer onSend={(t) => void onSend(t)} disabled={composerDisabled} blockedReason={blockedReason} />
      </section>
      {citation ? <SourceDrawer citation={citation} onClose={() => setCitation(null)} /> : null}
    </div>
  );
}
