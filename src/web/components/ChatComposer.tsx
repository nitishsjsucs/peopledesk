import { useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

export const MAX_MESSAGE_CHARS = 2000;

type Props = { onSend: (text: string) => void; disabled: boolean };

export function ChatComposer({ onSend, disabled }: Props) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const over = text.length > MAX_MESSAGE_CHARS;
  const canSend = !disabled && trimmed.length > 0 && !over;

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    onSend(trimmed);
    setText("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor="chat-input" className="visually-hidden">
        Message
      </label>
      <div className="composer-row">
        <textarea
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about a policy, open a ticket, check onboarding or book orientation"
          rows={2}
          disabled={disabled}
          aria-describedby="chat-count"
        />
        <button type="submit" className="btn btn-primary" disabled={!canSend}>
          Send
        </button>
      </div>
      <span id="chat-count" className={`composer-count${over ? " over" : ""}`}>
        {text.length} / {MAX_MESSAGE_CHARS}
      </span>
    </form>
  );
}
