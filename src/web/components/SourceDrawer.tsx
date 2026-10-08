import { useEffect, useRef } from "react";
import { Link } from "react-router";
import type { Citation } from "../../shared/api-types.ts";
import { EffectiveDateBadge } from "./EffectiveDateBadge.tsx";

type Props = { citation: Citation; onClose: () => void };

/** The cited passage, its effective range and a link to the full version. */
export function SourceDrawer({ citation, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
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
          <button ref={closeRef} type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </header>
        <EffectiveDateBadge effectiveFrom={citation.effectiveFrom} effectiveTo={citation.effectiveTo} />
        <blockquote className="quote" data-testid="source-quote">
          {citation.quote}
        </blockquote>
        <Link to={`/policies/${citation.docId}/v/${citation.version}`} onClick={onClose}>
          Open {citation.docId} version {citation.version}
        </Link>
      </aside>
    </div>
  );
}
