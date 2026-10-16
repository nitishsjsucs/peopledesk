import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import type { Citation } from "../../shared/api-types.ts";
import { EffectiveDateBadge } from "./EffectiveDateBadge.tsx";

type Props = { citation: Citation; onClose: () => void };

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The cited passage, its effective range and a link to the full version, as a modal dialog: it renders
 * outside the app root, makes the page behind it inert, keeps Tab inside, closes on Escape, Close, the
 * backdrop or the version link, and returns focus to whatever opened it.
 */
export function SourceDrawer({ citation, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  // The latest onClose, so the open/close effect runs once per opening, not on every parent render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const [host] = useState(() => document.createElement("div"));

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.appendChild(host);
    const behind = [...document.body.children].filter((el) => el !== host && !el.hasAttribute("inert"));
    for (const el of behind) el.setAttribute("inert", "");
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const current = document.activeElement;
      if (e.shiftKey && (current === first || !dialogRef.current.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !dialogRef.current.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      for (const el of behind) el.removeAttribute("inert");
      host.remove();
      if (opener?.isConnected) opener.focus();
    };
  }, [host]);

  return createPortal(
    <div className="drawer-backdrop" onClick={() => onCloseRef.current()}>
      <aside
        ref={dialogRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-drawer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="source-drawer-title">{citation.title}</h2>
            <div className="message-meta">
              {citation.docId} v{citation.version} · {citation.section}
            </div>
          </div>
          <button ref={closeRef} type="button" className="btn" onClick={() => onCloseRef.current()}>
            Close
          </button>
        </header>
        <EffectiveDateBadge effectiveFrom={citation.effectiveFrom} effectiveTo={citation.effectiveTo} />
        <blockquote className="quote" data-testid="source-quote">
          {citation.quote}
        </blockquote>
        <Link to={`/policies/${citation.docId}/v/${citation.version}`} onClick={() => onCloseRef.current()}>
          Open {citation.docId} version {citation.version}
        </Link>
      </aside>
    </div>,
    host,
  );
}
