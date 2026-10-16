import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

export const MAX_MESSAGE_CHARS = 2000;

type Props = {
  onSend: (text: string) => void;
  /** True while a turn runs or the transcript loads: nothing can be typed or sent. */
  disabled: boolean;
  /** Why sending is paused although typing is not (a rate limit countdown); Send stays disabled while set. */
  blockedReason?: string | null;
  /** Bumped when a turn starts outside the composer (a suggestion), so focus comes here afterwards. */
  focusRequest?: number;
  /** Bumped when a turn ends, so focus returns even when the disabled state never visibly changed. */
  settled?: number;
};

export function ChatComposer({ onSend, disabled, blockedReason, focusRequest = 0, settled = 0 }: Props) {
  const [text, setText] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The textarea is disabled while a turn runs, which drops focus to the page. When the send started
  // here (or from a suggestion), focus comes back once typing is possible again, unless the person has
  // moved focus somewhere else in the meantime.
  const wantFocus = useRef(false);

  useEffect(() => {
    if (focusRequest > 0) wantFocus.current = true;
  }, [focusRequest]);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (!formRef.current?.contains(e.target as Node)) wantFocus.current = false;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  useEffect(() => {
    if (disabled || !wantFocus.current) return;
    const active = document.activeElement;
    if (!active || active === document.body || formRef.current?.contains(active)) inputRef.current?.focus();
  }, [disabled, settled]);
  const trimmed = text.trim();
  const over = text.length > MAX_MESSAGE_CHARS;
  const canSend = !disabled && !blockedReason && trimmed.length > 0 && !over;

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    const active = document.activeElement;
    wantFocus.current = !active || active === document.body || Boolean(formRef.current?.contains(active));
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
    <form className="composer" onSubmit={submit} ref={formRef}>
      <label htmlFor="chat-input" className="visually-hidden">
        Message
      </label>
      <div className="composer-row">
        <textarea
          ref={inputRef}
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about a policy, open a ticket, check onboarding or book orientation"
          rows={2}
          disabled={disabled}
          aria-describedby={blockedReason ? "chat-count chat-blocked" : "chat-count"}
        />
        <button type="submit" className="btn btn-primary" disabled={!canSend}>
          Send
        </button>
      </div>
      <div className="composer-foot">
        {blockedReason ? (
          <span id="chat-blocked" className="composer-blocked">
            {blockedReason}
          </span>
        ) : null}
        <span id="chat-count" className={`composer-count${over ? " over" : ""}`}>
          {text.length} / {MAX_MESSAGE_CHARS}
        </span>
      </div>
    </form>
  );
}
