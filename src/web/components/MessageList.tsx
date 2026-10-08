import { useEffect, useRef } from "react";
import type { Citation, TurnResult } from "../../shared/api-types.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { CitationChip } from "./CitationChip.tsx";
import { ToolResultCard } from "./ToolResultCard.tsx";

export type ChatEntry =
  | { key: string; role: "user"; text: string }
  | { key: string; role: "assistant"; result: TurnResult; retryText?: string }
  | { key: string; role: "system"; text: string }
  | { key: string; role: "failure"; message: string; retryText: string };

type Props = {
  entries: ChatEntry[];
  sending: boolean;
  onOpenCitation: (c: Citation) => void;
  onRetry: (text: string) => void;
};

/** Splits the deterministic "Source:" line from the answer; the chips show the sources. */
function answerBody(text: string): string {
  return text.replace(/\n\n(Sources?: .*)$/s, "").trim();
}

export function MessageList({ entries, sending, onOpenCitation, onRetry }: Props) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [entries.length, sending]);
  return (
    <div className="message-list" aria-live="polite" aria-busy={sending}>
      {entries.map((e) => {
        if (e.role === "user") {
          return (
            <div key={e.key} className="message message-user">
              {e.text}
            </div>
          );
        }
        if (e.role === "system") {
          return (
            <div key={e.key} className="message message-system">
              {e.text}
            </div>
          );
        }
        if (e.role === "failure") {
          return (
            <div key={e.key} className="message message-assistant kind-error" data-kind="error">
              <div className="bubble">{e.message}</div>
              <button type="button" className="btn btn-link" onClick={() => onRetry(e.retryText)}>
                Retry
              </button>
            </div>
          );
        }
        const r = e.result;
        return (
          <div key={e.key} className={`message message-assistant kind-${r.kind}`} data-kind={r.kind}>
            <div className="bubble">{r.kind === "answer" ? answerBody(r.text) : r.text}</div>
            {r.citations.length > 0 && r.kind === "answer" ? (
              <div className="citations" aria-label="Sources">
                {r.citations.map((c) => (
                  <CitationChip key={c.passageId} citation={c} onOpen={onOpenCitation} />
                ))}
              </div>
            ) : null}
            {r.kind === "tool_result" && r.toolCall ? (
              <div className="card" style={{ marginTop: 8 }}>
                <ToolResultCard tool={r.toolCall.tool} result={r.toolResult} />
              </div>
            ) : null}
            {r.kind === "approval_required" && r.pendingAction ? <ApprovalCard action={r.pendingAction} /> : null}
            {r.kind === "error" && e.retryText ? (
              <button type="button" className="btn btn-link" onClick={() => onRetry(e.retryText ?? "")}>
                Retry
              </button>
            ) : null}
          </div>
        );
      })}
      {sending ? <div className="thinking">PeopleDesk is working on it...</div> : null}
      <div ref={end} />
    </div>
  );
}
