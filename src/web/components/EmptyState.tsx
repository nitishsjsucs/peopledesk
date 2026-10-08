import type { ReactNode } from "react";

type Props = { title: string; children?: ReactNode };

export function EmptyState({ title, children }: Props) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children ? <div>{children}</div> : null}
    </div>
  );
}
