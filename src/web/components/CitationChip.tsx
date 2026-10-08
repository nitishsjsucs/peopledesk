import type { Citation } from "../../shared/api-types.ts";
import { formatDate } from "../lib/format.ts";

type Props = { citation: Citation; onOpen: (c: Citation) => void };

export function CitationChip({ citation, onOpen }: Props) {
  const label = `${citation.docId} v${citation.version}`;
  return (
    <button
      type="button"
      className="citation-chip"
      onClick={() => onOpen(citation)}
      aria-label={`Source: ${citation.title}, ${label}, effective ${citation.effectiveFrom}. Open the source.`}
    >
      <span className="chip-title">{citation.title}</span>
      <span className="chip-meta">
        {label} · effective {formatDate(citation.effectiveFrom)}
      </span>
    </button>
  );
}
