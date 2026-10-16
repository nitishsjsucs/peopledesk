import type { ReactNode } from "react";

/** `level` 1 when the empty state is the whole page (a page has exactly one h1). */
type Props = { title: string; level?: 1 | 2; children?: ReactNode };

/** A neutral, decorative illustration (an empty tray) above the message. */
function Illustration() {
  return (
    <svg className="empty-illustration" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path
        d="M10 36 L18 14 H46 L54 36 V50 a4 4 0 0 1 -4 4 H14 a4 4 0 0 1 -4 -4 Z M10 36 H24 a8 8 0 0 0 16 0 H54"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EmptyState({ title, level = 2, children }: Props) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className="empty">
      <Illustration />
      <Heading>{title}</Heading>
      {children ? <div>{children}</div> : null}
    </div>
  );
}
